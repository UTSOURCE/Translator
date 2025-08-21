// contentScript.js - Translate page text in-place using Chrome Translator API, preserving layout

(() => {
  // Check if this script has already been loaded to prevent multiple instances
  if (window.translatorContentScriptLoaded) {
    console.log('Translator content script already loaded, skipping...');
    return;
  }
  window.translatorContentScriptLoaded = true;

  // State for page translation
  let enabled = false;
  let translator = null;
  let currentTargetLang = 'zh-Hans';
  const originalText = new Map(); // Text node -> original string (Map so we can iterate/restore)
  let observer = null;

  // State for selection translation
  let selectionTranslator = null;
  let selectionSourceLang = null;
  let selectionTargetLang = 'zh-Hans';
  let translationTooltip = null;
  let selectionTimeout = null;
  let isTranslatingSelection = false;
  let lastTranslatedText = null; // Track last translated text to avoid duplicates
  let isInitialized = false; // Prevent multiple initializations
  let selectionTranslateEnabled = false; // Control whether selection translation is enabled

  // Simple inline overlay for status/progress
  let overlayEl = null;
  function showOverlay(msg) {
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.style.cssText = [
        'position:fixed',
        'right:12px',
        'bottom:12px',
        'max-width:40vw',
        'z-index:2147483647',
        'background:#111827',
        'color:#fff',
        'padding:8px 10px',
        'border-radius:8px',
        'font:12px/1.4 -apple-system,system-ui,Segoe UI,Roboto,sans-serif',
        'box-shadow:0 6px 20px rgba(0,0,0,.25)',
        'opacity:.95',
        'pointer-events:none',
      ].join(';');
      document.documentElement.appendChild(overlayEl);
    }
    overlayEl.textContent = String(msg || '');
  }
  function hideOverlay() {
    if (overlayEl) overlayEl.remove();
    overlayEl = null;
  }

  // Translation tooltip for selected text
  function createTranslationTooltip() {
    const tooltip = document.createElement('div');
    tooltip.style.cssText = [
      'position:absolute',
      'z-index:2147483647',
      'background:#1f2937',
      'color:#fff',
      'padding:8px 12px',
      'border-radius:8px',
      'font:13px/1.4 -apple-system,system-ui,Segoe UI,Roboto,sans-serif',
      'box-shadow:0 4px 12px rgba(0,0,0,0.3)',
      'max-width:300px',
      'word-wrap:break-word',
      'opacity:0',
      'transform:translateY(4px)',
      'transition:opacity 0.2s ease, transform 0.2s ease',
      'pointer-events:auto',
      'border:1px solid rgba(255,255,255,0.1)',
      'display:flex',
      'flex-direction:column',
      'gap:6px'
    ].join(';');

    // Translation text container
    const textContainer = document.createElement('div');
    textContainer.style.cssText = [
      'flex:1',
      'word-wrap:break-word'
    ].join(';');

    // Copy button
    const copyButton = document.createElement('button');
    copyButton.textContent = '复制';
    copyButton.style.cssText = [
      'background:#374151',
      'color:#fff',
      'border:1px solid rgba(255,255,255,0.2)',
      'border-radius:4px',
      'padding:4px 8px',
      'font-size:11px',
      'cursor:pointer',
      'transition:background 0.2s ease',
      'align-self:flex-end'
    ].join(';');

    // Copy button hover effect
    copyButton.addEventListener('mouseenter', () => {
      copyButton.style.background = '#4b5563';
    });
    copyButton.addEventListener('mouseleave', () => {
      copyButton.style.background = '#374151';
    });

    // Copy functionality
    copyButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      const textToCopy = textContainer.textContent;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(textToCopy);
        } else {
          // Fallback for older browsers
          const textArea = document.createElement('textarea');
          textArea.value = textToCopy;
          textArea.style.position = 'fixed';
          textArea.style.opacity = '0';
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
        }

        // Visual feedback
        const originalText = copyButton.textContent;
        copyButton.textContent = '已复制';
        copyButton.style.background = '#10b981';
        setTimeout(() => {
          copyButton.textContent = originalText;
          copyButton.style.background = '#374151';
        }, 1000);
      } catch (err) {
        console.warn('复制失败:', err);
        copyButton.textContent = '复制失败';
        copyButton.style.background = '#ef4444';
        setTimeout(() => {
          copyButton.textContent = '复制';
          copyButton.style.background = '#374151';
        }, 1000);
      }
    });

    tooltip.appendChild(textContainer);
    tooltip.appendChild(copyButton);

    // Add arrow pointing down
    const arrow = document.createElement('div');
    arrow.style.cssText = [
      'position:absolute',
      'bottom:-6px',
      'left:50%',
      'transform:translateX(-50%)',
      'width:0',
      'height:0',
      'border-left:6px solid transparent',
      'border-right:6px solid transparent',
      'border-top:6px solid #1f2937'
    ].join(';');
    tooltip.appendChild(arrow);

    // Store references for easy access
    tooltip._textContainer = textContainer;
    tooltip._copyButton = copyButton;

    return tooltip;
  }

  function showTranslationTooltip(text, x, y) {
    hideTranslationTooltip();

    const tooltip = createTranslationTooltip();
    tooltip._textContainer.textContent = text;
    document.body.appendChild(tooltip);

    // Position tooltip above the selection
    const rect = tooltip.getBoundingClientRect();
    const finalX = Math.max(10, Math.min(x - rect.width / 2, window.innerWidth - rect.width - 10));
    const finalY = Math.max(10, y - rect.height - 10);

    tooltip.style.left = finalX + 'px';
    tooltip.style.top = finalY + 'px';

    // Set global reference after positioning
    translationTooltip = tooltip;

    // Animate in
    requestAnimationFrame(() => {
      if (tooltip && tooltip.parentNode) {
        tooltip.style.opacity = '1';
        tooltip.style.transform = 'translateY(0)';
      }
    });
  }

  function showLoadingTooltip(x, y) {
    hideTranslationTooltip();

    const tooltip = createTranslationTooltip();
    tooltip._textContainer.textContent = '翻译中...';
    tooltip.style.background = '#374151';
    tooltip._copyButton.style.display = 'none'; // Hide copy button during loading
    document.body.appendChild(tooltip);

    // Position tooltip
    const rect = tooltip.getBoundingClientRect();
    const finalX = Math.max(10, Math.min(x - rect.width / 2, window.innerWidth - rect.width - 10));
    const finalY = Math.max(10, y - rect.height - 10);

    tooltip.style.left = finalX + 'px';
    tooltip.style.top = finalY + 'px';

    // Set global reference after positioning
    translationTooltip = tooltip;

    // Animate in
    requestAnimationFrame(() => {
      if (tooltip && tooltip.parentNode) {
        tooltip.style.opacity = '1';
        tooltip.style.transform = 'translateY(0)';
      }
    });
  }

  function showErrorTooltip(message, x, y) {
    hideTranslationTooltip();

    const tooltip = createTranslationTooltip();
    tooltip._textContainer.textContent = message;
    tooltip.style.background = '#dc2626'; // Red background for errors
    tooltip._copyButton.style.display = 'none'; // Hide copy button for errors
    document.body.appendChild(tooltip);

    // Position tooltip
    const rect = tooltip.getBoundingClientRect();
    const finalX = Math.max(10, Math.min(x - rect.width / 2, window.innerWidth - rect.width - 10));
    const finalY = Math.max(10, y - rect.height - 10);

    tooltip.style.left = finalX + 'px';
    tooltip.style.top = finalY + 'px';

    // Set global reference after positioning
    translationTooltip = tooltip;

    // Animate in
    requestAnimationFrame(() => {
      if (tooltip && tooltip.parentNode) {
        tooltip.style.opacity = '1';
        tooltip.style.transform = 'translateY(0)';
      }
    });
  }

  function hideTranslationTooltip() {
    if (translationTooltip) {
      try {
        if (translationTooltip.parentNode) {
          translationTooltip.remove();
        }
      } catch (e) {
        console.warn('Error removing translation tooltip:', e);
      }
      translationTooltip = null;
    }
  }

  const EXCLUDED = new Set(['SCRIPT','STYLE','NOSCRIPT','IFRAME','CANVAS','SVG','CODE','PRE','TEXTAREA','INPUT','BUTTON','SELECT']);

  function* walkTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node) return NodeFilter.FILTER_REJECT;
        if (!node.parentElement) return NodeFilter.FILTER_REJECT;
        const pe = node.parentElement;
        if (EXCLUDED.has(pe.tagName)) return NodeFilter.FILTER_REJECT;
        const txt = node.nodeValue || '';
        if (!txt.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let cur;
    while ((cur = walker.nextNode())) {
      yield cur;
    }
  }

  function samplePageText(maxLen = 2000) {
    let acc = '';
    for (const tn of walkTextNodes(document.body || document.documentElement)) {
      const t = (tn.nodeValue || '').trim();
      if (!t) continue;
      if (acc.length + t.length + 1 > maxLen) break;
      acc += (acc ? '\n' : '') + t;
      if (acc.length >= maxLen) break;
    }
    return acc;
  }

  function normalizeLang(code) {
    if (!code) return code;
    if (code === 'zh') return 'zh-Hans';
    return code;
  }

  // Get next target language when source and target are the same
  function getNextTargetLanguage(currentLang) {
    const languages = ['zh-Hans', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'it', 'pt', 'zh-Hant'];
    const currentIndex = languages.indexOf(currentLang);
    if (currentIndex === -1) {
      return 'zh-Hans'; // Default fallback
    }
    // Return next language in the list, wrap around to beginning if at end
    return languages[(currentIndex + 1) % languages.length];
  }

  async function detectSourceLanguage() {
    try {
      if (typeof window.LanguageDetector === 'undefined') return null;
      const text = samplePageText();
      if (!text) return null;
      const detector = await window.LanguageDetector.create({ expectedInputLanguages: ['en','zh-Hans','zh-Hant','ja','ko','fr','de','es','ru','it','pt'] });
      const results = await detector.detect(text);
      detector.destroy?.();
      if (Array.isArray(results) && results.length > 0) {
        return results[0].detectedLanguage || null;
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  // Detect language for selected text
  async function detectTextLanguage(text) {
    try {
      if (!isTranslatorAPIAvailable()) return null;
      if (!text || text.trim().length < 2) return null;

      const detector = await window.LanguageDetector.create({
        expectedInputLanguages: ['en','zh-Hans','zh-Hant','ja','ko','fr','de','es','ru','it','pt']
      });
      const results = await detector.detect(text);
      detector.destroy?.();

      if (Array.isArray(results) && results.length > 0) {
        return results[0].detectedLanguage || null;
      }
    } catch (e) {
      console.warn('Language detection failed:', e);
    }
    return null;
  }

  async function ensureTranslator(sourceLang, targetLang) {
    if (translator && currentTargetLang === targetLang) return translator;
    if (typeof window.Translator === 'undefined') {
      throw new Error('此页面上下文不支持 Translator API（需要 Chrome 138+ 且安全上下文）。');
    }
    const src = normalizeLang(sourceLang || 'en');
    const tgt = normalizeLang(targetLang || 'zh-Hans');
    if (translator) {
      try { translator.destroy?.(); } catch {}
    }
    translator = await window.Translator.create({ sourceLanguage: src, targetLanguage: tgt });
    currentTargetLang = tgt;
    return translator;
  }

  // Check if Translator API is available
  function isTranslatorAPIAvailable() {
    return typeof window.Translator !== 'undefined' &&
           typeof window.LanguageDetector !== 'undefined' &&
           window.isSecureContext;
  }

  // Ensure translator for selection translation
  async function ensureSelectionTranslator(sourceLang, targetLang) {
    const src = normalizeLang(sourceLang || 'en');
    const tgt = normalizeLang(targetLang || 'en');

    // Check if we can reuse the existing translator
    if (selectionTranslator && selectionSourceLang === src && selectionTargetLang === tgt) {
      return selectionTranslator;
    }

    if (!isTranslatorAPIAvailable()) {
      throw new Error('TRANSLATOR_API_NOT_AVAILABLE');
    }

    // Destroy existing translator if any
    if (selectionTranslator) {
      try { selectionTranslator.destroy?.(); } catch {}
    }

    console.log(`Creating new translator: ${src} -> ${tgt}`);
    selectionTranslator = await window.Translator.create({ sourceLanguage: src, targetLanguage: tgt });
    selectionSourceLang = src;
    selectionTargetLang = tgt;
    return selectionTranslator;
  }

  // Translate selected text with automatic fallback for unsupported language pairs
  async function translateSelectedText(text, sourceLang, targetLang, maxRetries = 3) {
    let currentTargetLang = targetLang;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        // Skip if source and target are the same
        if (sourceLang === currentTargetLang) {
          currentTargetLang = getNextTargetLanguage(currentTargetLang);
          console.log(`Source equals target (${sourceLang}), switching to ${currentTargetLang}`);
          continue;
        }

        const translator = await ensureSelectionTranslator(sourceLang, currentTargetLang);
        const translation = await translator.translate(text);

        // If we had to switch languages, log it
        if (currentTargetLang !== targetLang) {
          console.log(`Successfully translated using fallback language: ${sourceLang} -> ${currentTargetLang}`);
        }

        return translation;
      } catch (e) {
        console.warn(`Translation failed (${sourceLang} -> ${currentTargetLang}):`, e);

        // Handle specific error types
        if (e.message === 'TRANSLATOR_API_NOT_AVAILABLE') {
          throw new Error('API_NOT_AVAILABLE');
        }

        // Check if it's an unsupported language pair error
        const isUnsupportedPair = e.message?.includes('language pair is unsupported') ||
                                 e.message?.includes('Unable to create translator') ||
                                 e.name === 'NotSupportedError';

        if (isUnsupportedPair && retryCount < maxRetries - 1) {
          // Try next target language
          const nextLang = getNextTargetLanguage(currentTargetLang);
          console.log(`Language pair ${sourceLang}->${currentTargetLang} unsupported, trying ${sourceLang}->${nextLang}`);
          currentTargetLang = nextLang;
          retryCount++;

          // Clear the failed translator
          if (selectionTranslator) {
            try { selectionTranslator.destroy?.(); } catch {}
            selectionTranslator = null;
            selectionSourceLang = null;
            selectionTargetLang = null;
          }

          continue;
        }

        // Handle other DOMException and API errors
        if (e instanceof DOMException || e.name === 'DOMException') {
          throw new Error('API_ERROR');
        }

        // If we've exhausted retries or it's not a language pair issue, throw the error
        throw e;
      }
    }

    // If we get here, all retries failed
    throw new Error(`Failed to translate after ${maxRetries} attempts with different target languages`);
  }

  async function translateTextNodes(targetLang) {
    enabled = true;
    showOverlay('正在准备页面翻译...');

    let sourceLang = await detectSourceLanguage();
    if (!sourceLang) sourceLang = 'en';

    await ensureTranslator(sourceLang, targetLang);

    const nodes = Array.from(walkTextNodes(document.body || document.documentElement));
    const total = nodes.length;
    let done = 0;

    showOverlay(`正在翻译页面 (${done}/${total})...`);

    for (const tn of nodes) {
      if (!enabled) break; // interrupted
      const orig = tn.nodeValue || '';
      if (!orig.trim()) { done++; continue; }
      if (!originalText.has(tn)) originalText.set(tn, orig);
      try {
        const translated = await translator.translate(orig);
        // only replace if unchanged to reduce race effects
        if (enabled && (tn.nodeValue === orig || !tn.nodeValue)) {
          tn.nodeValue = translated;
        }
      } catch (e) {
        // Skip on error
      } finally {
        done++;
        if (done % 20 === 0 || done === total) {
          showOverlay(`正在翻译页面 (${done}/${total})...`);
        }
      }
    }

    showOverlay('页面翻译完成');
    setTimeout(hideOverlay, 1200);

    // Observe dynamic changes
    setupObserver();
  }

  function setupObserver() {
    cleanupObserver();
    observer = new MutationObserver(async (mutations) => {
      if (!enabled || !translator) return;
      const newTextNodes = [];
      for (const m of mutations) {
        for (const node of m.addedNodes || []) {
          if (node.nodeType === Node.TEXT_NODE) {
            newTextNodes.push(node);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            for (const tn of walkTextNodes(node)) newTextNodes.push(tn);
          }
        }
      }
      if (newTextNodes.length === 0) return;
      for (const tn of newTextNodes) {
        const orig = tn.nodeValue || '';
        if (!orig.trim()) continue;
        if (!originalText.has(tn)) originalText.set(tn, orig);
        try {
          const translated = await translator.translate(orig);
          if (enabled && (tn.nodeValue === orig || !tn.nodeValue)) tn.nodeValue = translated;
        } catch {}
      }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  function cleanupObserver() {
    observer?.disconnect();
    observer = null;
  }

  function restorePage() {
    enabled = false;
    cleanupObserver();
    hideOverlay();
    for (const [tn, orig] of originalText.entries()) {
      try {
        if (tn && tn.nodeType === Node.TEXT_NODE) tn.nodeValue = orig;
      } catch {}
    }
    originalText.clear();
    try { translator?.destroy?.(); } catch {}
    translator = null;
  }

  // Handle text selection for translation
  async function handleTextSelection() {
    const timestamp = Date.now();

    // Check if selection translation is enabled
    if (!selectionTranslateEnabled) {
      hideTranslationTooltip();
      return;
    }

    if (isTranslatingSelection) {
      console.log(`[${timestamp}] Translation already in progress, skipping...`);
      return;
    }

    // Check if API is available first
    if (!isTranslatorAPIAvailable()) {
      return; // Silently skip if API is not available
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      hideTranslationTooltip();
      lastTranslatedText = null;
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText || selectedText.length < 2) {
      hideTranslationTooltip();
      lastTranslatedText = null;
      return;
    }

    // Skip if this is the same text we just translated
    if (selectedText === lastTranslatedText) {
      console.log(`[${timestamp}] Same text as last translation, skipping...`);
      return;
    }

    // Skip if text is too long (avoid translating entire paragraphs accidentally)
    if (selectedText.length > 500) {
      hideTranslationTooltip();
      return;
    }

    // Skip if text contains mostly numbers or special characters
    if (!/[a-zA-Z\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(selectedText)) {
      hideTranslationTooltip();
      return;
    }

    // Global lock to prevent multiple instances from translating simultaneously
    if (window.translatorGlobalLock) {
      console.log(`[${timestamp}] Global translation lock active, skipping...`);
      return;
    }
    window.translatorGlobalLock = true;

    // Get selection position for tooltip placement
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const topY = rect.top + window.scrollY; // Add scroll offset for correct positioning

    isTranslatingSelection = true;

    try {
      // Show loading indicator
      showLoadingTooltip(centerX, topY);

      // Get target language from storage or use default
      let targetLang = 'en'; // Default to English instead of Chinese
      try {
        const result = await chrome.storage.sync.get(['autoTranslateTargetLang']);
        if (result.autoTranslateTargetLang) {
          targetLang = result.autoTranslateTargetLang;
        }
      } catch (e) {
        // Use default if storage access fails
        console.warn('Failed to get target language from storage, using default:', e);
      }

      // Detect source language
      const detectedLang = await detectTextLanguage(selectedText);
      const sourceLang = detectedLang || 'en';

      console.log(`[${timestamp}] Translating: "${selectedText}" (${sourceLang} -> ${targetLang})`);

      // Translate the text (with automatic fallback for unsupported language pairs)
      const translation = await translateSelectedText(selectedText, sourceLang, targetLang);

      if (translation && translation !== selectedText) {
        // Store the translated text to avoid duplicates
        lastTranslatedText = selectedText;

        // Show translation tooltip
        showTranslationTooltip(translation, centerX, topY);
        // Make sure copy button is visible
        if (translationTooltip && translationTooltip._copyButton) {
          translationTooltip._copyButton.style.display = 'block';
          translationTooltip.style.background = '#1f2937'; // Reset background color
        }

        console.log(`[${timestamp}] Translation completed: "${selectedText}" -> "${translation}"`);
      } else {
        hideTranslationTooltip();
        lastTranslatedText = null;
      }
    } catch (e) {
      console.warn(`[${timestamp}] Selection translation failed:`, e);

      // Show user-friendly error message for unsupported language pairs
      if (e.message?.includes('Failed to translate after') ||
          e.message?.includes('language pair is unsupported')) {
        showErrorTooltip('该语言对不支持翻译', centerX, topY);
        setTimeout(hideTranslationTooltip, 3000); // Auto-hide after 3 seconds
      } else {
        hideTranslationTooltip();
      }

      lastTranslatedText = null;
    } finally {
      isTranslatingSelection = false;
      window.translatorGlobalLock = false; // Release global lock
    }
  }

  // Debounced selection handler
  function onSelectionChange() {
    if (selectionTimeout) {
      clearTimeout(selectionTimeout);
    }

    selectionTimeout = setTimeout(() => {
      handleTextSelection();
    }, 500); // Increased debounce to 500ms to reduce duplicate triggers
  }

  // Initialize selection translation
  async function initSelectionTranslation() {
    // Prevent multiple initializations
    if (isInitialized) {
      console.log('Selection translation already initialized, skipping...');
      return;
    }

    // Check if we should enable selection translation
    if (!isTranslatorAPIAvailable()) {
      console.info('Translator API not available on this page. Selection translation disabled.');
      return;
    }

    // Load selection translation setting from storage
    try {
      const result = await chrome.storage.sync.get(['selectionTranslateEnabled']);
      selectionTranslateEnabled = !!result.selectionTranslateEnabled;
      console.info(`Selection translation ${selectionTranslateEnabled ? 'enabled' : 'disabled'} from storage.`);
    } catch (e) {
      console.warn('Failed to load selection translation setting, defaulting to disabled:', e);
      selectionTranslateEnabled = false;
    }

    console.info('Translator API available. Selection translation initialized.');

    // Listen for selection changes
    document.addEventListener('selectionchange', onSelectionChange);

    // Hide tooltip when clicking elsewhere
    document.addEventListener('click', () => {
      // Small delay to allow new selection to be processed
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || !selection.toString().trim()) {
          hideTranslationTooltip();
          lastTranslatedText = null; // Reset when clearing selection
        }
      }, 100);
    });

    // Hide tooltip on scroll
    document.addEventListener('scroll', () => {
      hideTranslationTooltip();
      lastTranslatedText = null; // Reset when scrolling
    }, { passive: true });

    // Hide tooltip on window resize
    window.addEventListener('resize', () => {
      hideTranslationTooltip();
      lastTranslatedText = null; // Reset when resizing
    });

    isInitialized = true;
    console.log('Selection translation initialized successfully');
  }

  // Cleanup selection translation
  function cleanupSelectionTranslation() {
    document.removeEventListener('selectionchange', onSelectionChange);
    hideTranslationTooltip();
    if (selectionTimeout) {
      clearTimeout(selectionTimeout);
      selectionTimeout = null;
    }
    try { selectionTranslator?.destroy?.(); } catch {}
    selectionTranslator = null;
    selectionSourceLang = null;
    selectionTargetLang = null;
    lastTranslatedText = null;
    isInitialized = false;
    window.translatorGlobalLock = false; // Release global lock
    console.log('Selection translation cleaned up');
  }

  // Messaging
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        if (msg && msg.type === 'START_PAGE_TRANSLATION') {
          const lang = msg.targetLang || 'zh-Hans';
          if (!enabled) {
            await translateTextNodes(lang);
          } else if (currentTargetLang !== normalizeLang(lang)) {
            // Retarget: re-translate current page to new target
            enabled = true;
            showOverlay('正在切换目标语言...');
            let sourceLang = await detectSourceLanguage();
            if (!sourceLang) sourceLang = 'en';
            await ensureTranslator(sourceLang, lang);
            // Re-run over current text nodes only (no restore)
            const nodes = Array.from(walkTextNodes(document.body || document.documentElement));
            for (const tn of nodes) {
              const now = tn.nodeValue || '';
              if (!now.trim()) continue;
              try {
                const translated = await translator.translate(originalText.get(tn) ?? now);
                if (enabled) tn.nodeValue = translated;
              } catch {}
            }
            showOverlay('切换完成');
            setTimeout(hideOverlay, 1000);
          }
          sendResponse({ ok: true, enabled, targetLang: currentTargetLang });
          return;
        }
        if (msg && msg.type === 'STOP_PAGE_TRANSLATION') {
          restorePage();
          sendResponse({ ok: true });
          return;
        }
        if (msg && msg.type === 'QUERY_STATUS') {
          sendResponse({ ok: true, enabled, targetLang: currentTargetLang });
          return;
        }
        if (msg && msg.type === 'TOGGLE_SELECTION_TRANSLATION') {
          const enabled = !!msg.enabled;
          selectionTranslateEnabled = enabled;
          console.log(`Selection translation ${enabled ? 'enabled' : 'disabled'} via message.`);

          // If disabled, hide any existing tooltip
          if (!enabled) {
            hideTranslationTooltip();
            lastTranslatedText = null;
          }

          sendResponse({ ok: true, selectionTranslateEnabled: enabled });
          return;
        }
      } catch (e) {
        showOverlay(String(e?.message || e || 'Error'));
        setTimeout(hideOverlay, 2000);
        sendResponse({ ok: false, error: String(e?.message || e || 'Error') });
        return;
      }
    })();
    return true; // keep channel open for async
  });

  // Initialize selection translation when script loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSelectionTranslation);
  } else {
    initSelectionTranslation();
  }

  // Cleanup when page unloads
  window.addEventListener('beforeunload', () => {
    cleanupSelectionTranslation();
    try { translator?.destroy?.(); } catch {}
    try { selectionTranslator?.destroy?.(); } catch {}
  });
})();


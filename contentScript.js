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

  // State for floating button
  let floatingButton = null;
  let floatingButtonEnabled = false;
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

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
        
        // 排除基本标签
        if (EXCLUDED.has(pe.tagName)) return NodeFilter.FILTER_REJECT;
        
        // 排除漂浮翻译按钮及其子元素
        let element = pe;
        while (element) {
          if (element.id === 'translator-floating-button') {
            return NodeFilter.FILTER_REJECT;
          }
          element = element.parentElement;
        }
        
        // 排除翻译提示框和可能的其他翻译工具元素
        element = pe;
        while (element) {
          if (element.id && (
            element.id.includes('translator') || 
            element.id.includes('translation') ||
            element.classList?.contains('translator-overlay') ||
            element.classList?.contains('translation-tooltip')
          )) {
            return NodeFilter.FILTER_REJECT;
          }
          element = element.parentElement;
        }
        
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

    // 更新漂浮按钮状态
    console.log('translateTextNodes: Updating floating button state, enabled now:', enabled);
    if (floatingButton && floatingButtonEnabled) {
      console.log('translateTextNodes: Setting button text to "恢复"');
      floatingButton.innerHTML = '恢复';
      floatingButton.title = '点击恢复原始网页';
    } else {
      console.log('translateTextNodes: Button not updated - floatingButton:', !!floatingButton, 'floatingButtonEnabled:', floatingButtonEnabled);
    }

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
    console.log('restorePage: Starting page restoration, current enabled:', enabled);
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
    
    // 更新漂浮按钮状态
    console.log('restorePage: Updating floating button state, enabled now:', enabled);
    if (floatingButton && floatingButtonEnabled) {
      console.log('restorePage: Setting button text to "翻译"');
      floatingButton.innerHTML = '翻译';
      floatingButton.title = '点击翻译当前网页';
    } else {
      console.log('restorePage: Button not updated - floatingButton:', !!floatingButton, 'floatingButtonEnabled:', floatingButtonEnabled);
    }
    console.log('restorePage: Page restoration completed');
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
      console.warn('Failed to load selection translation setting, using defaults:', e);
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

  // Initialize floating button (independent of API availability)
  async function initFloatingButton() {
    console.log('initFloatingButton: Starting initialization...');
    
    // Check if document.body is available
    if (!document.body) {
      console.warn('initFloatingButton: document.body not available, will retry after DOM load');
      // Wait for body to be available
      const observer = new MutationObserver(() => {
        if (document.body) {
          observer.disconnect();
          console.log('initFloatingButton: document.body now available, retrying...');
          initFloatingButton();
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      return;
    }
    
    try {
      console.log('initFloatingButton: Loading settings from storage...');
      const result = await chrome.storage.sync.get(['floatingButtonEnabled']);
      floatingButtonEnabled = !!result.floatingButtonEnabled;
      console.info(`Floating button ${floatingButtonEnabled ? 'enabled' : 'disabled'} from storage.`);
      
      // Show floating button if enabled
      if (floatingButtonEnabled) {
        console.log('initFloatingButton: Showing floating button...');
        showFloatingButton();
      } else {
        console.log('initFloatingButton: Floating button disabled, not showing');
      }
    } catch (e) {
      console.warn('Failed to load floating button setting, using defaults:', e);
      floatingButtonEnabled = false;
    }
    
    console.log('initFloatingButton: Initialization completed');
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

  // Floating button functions
  function createFloatingButton() {
    console.log('createFloatingButton: Called, existing button:', !!floatingButton);
    
    if (floatingButton) {
      console.log('createFloatingButton: Returning existing button');
      return floatingButton;
    }

    console.log('createFloatingButton: Creating new button...');
    const button = document.createElement('div');
    button.id = 'translator-floating-button';
    button.innerHTML = '翻译'; // 显示"翻译"文字
    button.title = '点击翻译当前网页';
    
    console.log('createFloatingButton: Applying styles...');
    // Apply styles - 长方形按钮样式
    button.style.cssText = [
      'position: fixed',
      'top: 50%', // 垂直居中
      'right: 20px', // 右侧位置
      'transform: translateY(-50%)', // 精确垂直居中
      'width: 60px', // 长方形宽度
      'height: 32px', // 长方形高度
      'background: linear-gradient(135deg, #4a90e2 0%, #357abd 100%)',
      'color: white',
      'border: none',
      'border-radius: 16px', // 圆角长方形
      'font-size: 14px',
      'font-weight: 500',
      'text-align: center',
      'line-height: 32px',
      'cursor: move',
      'z-index: 2147483647',
      'box-shadow: 0 4px 16px rgba(74, 144, 226, 0.4), 0 2px 8px rgba(0,0,0,0.2)',
      'user-select: none',
      'backdrop-filter: blur(10px)',
      'border: 2px solid rgba(255,255,255,0.2)',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    ].join(';');

    console.log('createFloatingButton: Adding event listeners...');
    
    // Helper function to get current base transform (position-related)
    function getBaseTransform() {
      const currentTransform = button.style.transform;
      if (currentTransform.includes('translateY(-50%)')) {
        return 'translateY(-50%)';
      } else {
        return 'none';
      }
    }
    
    // Hover effects - 适配长方形按钮
    button.addEventListener('mouseenter', () => {
      if (!isDragging) {
        button.style.transition = 'all 0.2s ease'; // 为悬停效果添加过渡
        const baseTransform = getBaseTransform();
        if (baseTransform === 'translateY(-50%)') {
          button.style.transform = 'translateY(-50%) scale(1.05)';
        } else {
          button.style.transform = 'scale(1.05)';
        }
        button.style.background = 'linear-gradient(135deg, #5aa6ff 0%, #4a90e2 100%)';
        button.style.boxShadow = '0 6px 24px rgba(74, 144, 226, 0.6), 0 4px 12px rgba(0,0,0,0.3)';
      }
    });

    button.addEventListener('mouseleave', () => {
      if (!isDragging) {
        button.style.transition = 'all 0.2s ease'; // 为悬停效果添加过渡
        const baseTransform = getBaseTransform();
        if (baseTransform === 'translateY(-50%)') {
          button.style.transform = 'translateY(-50%) scale(1)';
        } else {
          button.style.transform = 'scale(1)';
        }
        button.style.background = 'linear-gradient(135deg, #4a90e2 0%, #357abd 100%)';
        button.style.boxShadow = '0 4px 16px rgba(74, 144, 226, 0.4), 0 2px 8px rgba(0,0,0,0.2)';
        // 悬停效果结束后移除 transition，防止影响位置设置
        setTimeout(() => {
          button.style.transition = '';
        }, 200);
      }
    });

    // Make it draggable
    let startX, startY, initialX, initialY;

    function startDrag(e) {
      isDragging = true;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      
      startX = clientX;
      startY = clientY;
      initialX = button.offsetLeft;
      initialY = button.offsetTop;
      
      button.style.cursor = 'grabbing';
      
      // 保持垂直居中的同时缩小
      const baseTransform = getBaseTransform();
      if (baseTransform === 'translateY(-50%)') {
        button.style.transform = 'translateY(-50%) scale(0.95)';
      } else {
        button.style.transform = 'scale(0.95)';
      }
      
      e.preventDefault();
    }

    function drag(e) {
      if (!isDragging) return;
      
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      
      const deltaX = clientX - startX;
      const deltaY = clientY - startY;
      
      let newX = initialX + deltaX;
      let newY = initialY + deltaY;
      
      // Constrain to viewport - 适配长方形按钮尺寸 (60x32)
      const maxX = window.innerWidth - 60; // 按钮宽度
      const maxY = window.innerHeight - 32; // 按钮高度
      
      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY));
      
      // 清除两个定位属性，然后设置新的位置
      button.style.left = newX + 'px';
      button.style.right = 'auto';
      button.style.top = newY + 'px';
      button.style.transform = 'none'; // 拖动时移除 translateY 变换
      
      e.preventDefault();
    }

    function endDrag(e) {
      if (!isDragging) return;
      
      isDragging = false;
      button.style.cursor = 'move';
      // 检查按钮是否仍在垂直居中位置，如果不是则不使用 translateY
      const currentTop = parseInt(button.style.top);
      const windowHeight = window.innerHeight;
      const buttonHeight = 32;
      const isNearCenter = Math.abs(currentTop - (windowHeight - buttonHeight) / 2) < 50;
      
      if (isNearCenter) {
        button.style.transform = 'translateY(-50%) scale(1)'; // 恢复垂直居中
        button.style.top = '50%'; // 设置为垂直居中
      } else {
        button.style.transform = 'scale(1)'; // 不在中间时不使用 translateY
      }
      
      // Save position to storage
      const rect = button.getBoundingClientRect();
      const positionData = {
        top: rect.top,
        useTranslateY: isNearCenter // 记录是否使用 translateY
      };
      
      // 检查按钮是在右侧还是左侧，保存对应的属性
      const windowWidth = window.innerWidth;
      const buttonWidth = 60;
      const isOnRight = rect.left > windowWidth / 2;
      
      if (isOnRight) {
        positionData.right = windowWidth - rect.right;
      } else {
        positionData.left = rect.left;
      }
      
      chrome.storage.sync.set({
        floatingButtonPosition: positionData
      }).catch(() => {}); // Ignore errors
      
      e.preventDefault();
    }

    // Mouse events
    button.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', endDrag);

    // Touch events for mobile support
    button.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('touchmove', drag, { passive: false });
    document.addEventListener('touchend', endDrag, { passive: false });

    // Click handler for translation - 点击切换翻译/恢复状态
    button.addEventListener('click', async (e) => {
      if (isDragging) return; // Don't translate if we were dragging
      
      e.stopPropagation();
      e.preventDefault();
      
      console.log('FloatingButton: Click detected, current enabled state:', enabled);
      
      try {
        // Check if Translator API is available first
        if (!isTranslatorAPIAvailable()) {
          showOverlay('此页面不支持翻译功能（需要 Chrome 138+ 且安全上下文）');
          setTimeout(hideOverlay, 3000);
          return;
        }
        
        // 切换翻译状态：如果已翻译则恢复，如果未翻译则翻译
        if (enabled) {
          // 当前已翻译，点击恢复
          console.log('FloatingButton: Page is translated, calling restorePage()');
          restorePage(); // restorePage函数内部已经处理了按钮状态更新
        } else {
          // 当前未翻译，点击翻译
          console.log('FloatingButton: Page is not translated, calling translateTextNodes()');
          // Get current target language from storage or use default
          let targetLang = 'zh-Hans';
          try {
            const result = await chrome.storage.sync.get(['autoTranslateTargetLang']);
            if (result.autoTranslateTargetLang) {
              targetLang = result.autoTranslateTargetLang;
            }
          } catch {}
          
          await translateTextNodes(targetLang); // translateTextNodes函数内部已经处理了按钮状态更新
        }
        console.log('FloatingButton: Click processing completed, new enabled state:', enabled);
      } catch (error) {
        console.warn('Floating button translation failed:', error);
        showOverlay('翻译失败：' + (error?.message || error || ''));
        setTimeout(hideOverlay, 2000);
      }
    });

    console.log('createFloatingButton: Button created successfully, assigning to floatingButton variable');
    floatingButton = button;
    console.log('createFloatingButton: Returning button, ID:', button.id);
    return button;
  }

  function showFloatingButton() {
    console.log('showFloatingButton: Called with floatingButtonEnabled =', floatingButtonEnabled);
    
    if (!floatingButtonEnabled) {
      console.log('showFloatingButton: Floating button disabled, returning');
      return;
    }
    
    if (!document.body) {
      console.warn('showFloatingButton: document.body not available');
      return;
    }
    
    console.log('showFloatingButton: Creating button...');
    const button = createFloatingButton();
    
    if (!button) {
      console.error('showFloatingButton: Failed to create button');
      return;
    }
    
    if (button.parentNode) {
      console.log('showFloatingButton: Button already in DOM, skipping');
      return;
    }
    
    console.log('showFloatingButton: Adding button to DOM...');
    
    // Restore saved position
    chrome.storage.sync.get(['floatingButtonPosition']).then(result => {
      if (result.floatingButtonPosition) {
        const pos = result.floatingButtonPosition;
        // Ensure position is still within viewport - 适配长方形按钮尺寸 (60x32)
        const maxX = window.innerWidth - 60;
        const maxY = window.innerHeight - 32;
        
        // 处理位置恢复，支持 left 和 right 属性
        if (pos.right !== undefined) {
          // 使用 right 属性
          const x = Math.max(0, Math.min(pos.right, maxX));
          console.log('showFloatingButton: Restoring position to right:', x);
          button.style.right = x + 'px';
          button.style.left = 'auto'; // 清除 left 属性
        } else if (pos.left !== undefined) {
          // 兼容旧的 left 属性
          const x = Math.max(0, Math.min(pos.left, maxX));
          console.log('showFloatingButton: Restoring position to left:', x);
          button.style.left = x + 'px';
          button.style.right = 'auto'; // 清除 right 属性
        }
        
        const y = Math.max(0, Math.min(pos.top, maxY));
        
        // 根据保存的设置决定是否使用 translateY
        if (pos.useTranslateY) {
          button.style.top = '50%';
          button.style.transform = 'translateY(-50%)';
        } else {
          button.style.top = y + 'px';
          button.style.transform = 'none';
        }
      } else {
        console.log('showFloatingButton: No saved position, using default (right center)');
        // 默认位置：右侧中间
        button.style.right = '20px';
        button.style.left = 'auto';
        button.style.top = '50%';
        button.style.transform = 'translateY(-50%)';
      }
    }).catch(e => {
      console.warn('showFloatingButton: Error restoring position:', e);
      // 错误时使用默认位置
      button.style.right = '20px';
      button.style.left = 'auto';
      button.style.top = '50%';
      button.style.transform = 'translateY(-50%)';
    });
    
    try {
      document.body.appendChild(button);
      console.log('showFloatingButton: Button added to DOM successfully');
      
      // 根据当前状态设置按钮文字和提示
      if (enabled) {
        button.innerHTML = '恢复';
        button.title = '点击恢复原始网页';
      } else {
        button.innerHTML = '翻译';
        button.title = '点击翻译当前网页';
      }
      
      // 按钮直接显示，无动画效果
      button.style.opacity = '1';
      button.style.visibility = 'visible';
      console.log('showFloatingButton: Button displayed directly without animation');
    } catch (error) {
      console.error('showFloatingButton: Error adding button to DOM:', error);
    }
  }

  function hideFloatingButton() {
    if (floatingButton && floatingButton.parentNode) {
      floatingButton.style.transition = 'all 0.3s ease';
      floatingButton.style.opacity = '0';
      floatingButton.style.transform = 'scale(0.5)';
      
      setTimeout(() => {
        if (floatingButton && floatingButton.parentNode) {
          floatingButton.remove();
        }
      }, 300);
    }
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
            
            // 更新漂浮按钮状态
            if (floatingButton && floatingButtonEnabled) {
              floatingButton.innerHTML = '恢复';
              floatingButton.title = '点击恢复原始网页';
            }
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
          const selectionEnabled = !!msg.enabled;
          selectionTranslateEnabled = selectionEnabled;
          console.log(`Selection translation ${selectionEnabled ? 'enabled' : 'disabled'} via message.`);

          // If disabled, hide any existing tooltip
          if (!selectionEnabled) {
            hideTranslationTooltip();
            lastTranslatedText = null;
          }

          sendResponse({ ok: true, selectionTranslateEnabled: selectionEnabled });
          return;
        }
        if (msg && msg.type === 'TOGGLE_FLOATING_BUTTON') {
          const toggleEnabled = !!msg.enabled;
          floatingButtonEnabled = toggleEnabled;
          console.log(`Floating button ${toggleEnabled ? 'enabled' : 'disabled'} via message.`);

          if (toggleEnabled) {
            showFloatingButton();
          } else {
            hideFloatingButton();
          }

          sendResponse({ ok: true, floatingButtonEnabled: toggleEnabled });
          return;
        }
        if (msg && msg.type === 'FORCE_SHOW_FLOATING_BUTTON') {
          console.log('Force showing floating button for debugging...');
          floatingButtonEnabled = true;
          showFloatingButton();
          sendResponse({ ok: true, forced: true });
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

  // Initialize when script loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('DOMContentLoaded: Initializing...');
      setTimeout(() => {
        initSelectionTranslation();
        initFloatingButton();
      }, 100); // Small delay to ensure everything is ready
    });
  } else {
    console.log('Document already loaded, initializing immediately...');
    setTimeout(() => {
      initSelectionTranslation();
      initFloatingButton();
    }, 100); // Small delay to ensure everything is ready
  }
  
  // Additional safety check - force initialization after 1 second if needed
  setTimeout(() => {
    console.log('Safety check: Ensuring floating button is initialized...');
    if (!floatingButton) {
      console.log('Safety check: Floating button not created, forcing initialization...');
      initFloatingButton();
    } else if (floatingButtonEnabled && !floatingButton.parentNode) {
      console.log('Safety check: Floating button enabled but not in DOM, showing...');
      showFloatingButton();
    }
  }, 1000);

  // Cleanup when page unloads
  window.addEventListener('beforeunload', () => {
    cleanupSelectionTranslation();
    hideFloatingButton();
    try { translator?.destroy?.(); } catch {}
    try { selectionTranslator?.destroy?.(); } catch {}
  });
})();





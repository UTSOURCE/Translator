// popup.js - MV3 popup script using Translator and LanguageDetector APIs

const sourceSelect = document.getElementById("sourceLang");
const targetSelect = document.getElementById("targetLang");
const inputEl = document.getElementById("inputText");
const outputEl = document.getElementById("output");
const charCountEl = document.getElementById("charCount");

const statusEl = document.getElementById("status");
const translateBtn = document.getElementById("translateBtn");
const swapBtn = document.getElementById("swapBtn");
const copyBtn = document.getElementById("copyBtn");
const speakBtn = document.getElementById("speakBtn");
const autoToggle = document.getElementById("autoToggle");
const selectionToggle = document.getElementById("selectionToggle");
const floatingToggle = document.getElementById("floatingToggle");
const autoToggleStatus = document.getElementById("autoToggleStatus");
const selectionToggleStatus = document.getElementById("selectionToggleStatus");
const floatingToggleStatus = document.getElementById("floatingToggleStatus");

const manualPageBtn = document.getElementById("manualPageBtn");
const restorePageBtn = document.getElementById("restorePageBtn");
const feedbackBtn = document.getElementById("feedbackBtn");
const emailFeedbackBtn = document.getElementById("emailFeedbackBtn");


const downloadSection = document.getElementById("downloadSection");
function updateCharCount() {
  if (!charCountEl) return;
  const len = inputEl.value.length;
  charCountEl.textContent = `字数：${len}`;

  // Update character count styling based on length
  charCountEl.className = 'char-count';
  if (len > 1000) {
    charCountEl.classList.add('danger');
  } else if (len > 500) {
    charCountEl.classList.add('warning');
  }
}

inputEl.addEventListener("input", updateCharCount);
updateCharCount();

const downloadProgress = document.getElementById("downloadProgress");
const downloadPct = document.getElementById("downloadPct");
function setSpeakEnabled(enabled) {
  if (speakBtn) speakBtn.disabled = !enabled;
}
setSpeakEnabled(false);

function speakOutput() {
  const text = (outputEl.textContent || "").trim();
  if (!text) return;
  try {
    const utter = new SpeechSynthesisUtterance(text);
    // 根据目标语言设置语音语言，尽可能匹配
    const lang = targetSelect.value || "zh-Hans";
    utter.lang = lang.startsWith("zh") ? "zh-CN" : lang;
    utter.rate = 1.0;
    utter.pitch = 1.0;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  } catch (e) {
    console.warn("朗读失败", e);
    setStatus("朗读失败，可能浏览器不支持语音合成。", "warn");
  }
}


function setCopyEnabled(enabled) {
  if (copyBtn) copyBtn.disabled = !enabled;
}
setCopyEnabled(false);

async function copyOutput() {
  const text = (outputEl.textContent || "").trim();
  if (!text) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setStatus("已复制到剪贴板。", "ok");
    if (copyBtn) {
      const prev = copyBtn.textContent;
      copyBtn.textContent = "已复制";
      setTimeout(() => { if (copyBtn) copyBtn.textContent = prev || "复制"; }, 1000);
    }
  } catch (e) {
    console.warn("复制失败", e);
    setStatus("复制失败，请手动复制。", "warn");
  }
}


// A simple list of BCP-47 codes for demo purposes. Browsers may support a subset.
const LANGS = [
  ["auto", "自动检测"],

  ["en", "英语"],
  ["zh-Hans", "中文（简体 zh-Hans）"],
  ["zh-Hant", "中文（繁体 zh-Hant）"],
  ["ja", "日语"],
  ["ko", "韩语"],
  ["fr", "法语"],
  ["de", "德语"],
  ["es", "西班牙语"],
  ["ru", "俄语"],
  ["it", "意大利语"],
  ["pt", "葡萄牙语"],
];

function populateLangSelects() {
  sourceSelect.innerHTML = "";
  targetSelect.innerHTML = "";

  for (const [code, label] of LANGS) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = label;
    if (code === "auto") sourceSelect.appendChild(opt);
    else sourceSelect.appendChild(opt.cloneNode(true));
  }

  for (const [code, label] of LANGS) {
    if (code === "auto") continue; // target can't be auto
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = label;
    targetSelect.appendChild(opt);
  }

  // Defaults
  sourceSelect.value = "auto";
  targetSelect.value = "zh-Hans";
}

function setStatus(msg, cls = "") {
  statusEl.textContent = msg;
  statusEl.className = `hint small ${cls}`.trim();
}

// 更新开关状态文本
function updateToggleStatus(toggleElement, statusElement, enabled) {
  if (statusElement) {
    statusElement.textContent = enabled ? '已开启' : '已关闭';
    statusElement.style.color = enabled ? '#10b981' : '#6b7280';
  }
}

// Unified check for unsupported/invalid language pair errors across Chrome versions
function isPairUnsupported(msg) {
  const s = String(msg || "");
  return /Unable to create translator|requested language options are not supported|source and target language|language conflict/i.test(s);
}


// Normalize language code for Translator API (e.g., map 'zh' -> 'zh-Hans')
function normalizeLang(code) {
  if (!code) return code;
  if (code === "zh") return "zh-Hans";
  return code;
}



function featureDetect() {
  const hasTranslator = typeof window.Translator !== "undefined";
  const hasDetector = typeof window.LanguageDetector !== "undefined";
  return { hasTranslator, hasDetector };
}

async function checkAvailability(sourceLanguage, targetLanguage) {
  if (!window.Translator || !Translator.availability) return null;
  try {
    return await Translator.availability({
      sourceLanguage: normalizeLang(sourceLanguage),
      targetLanguage: normalizeLang(targetLanguage),
    });
  } catch (e) {
    return null;
  }
}

async function detectLanguageIfNeeded(text, hasDetector) {
  if (!text || !hasDetector) return null;
  try {
    const detector = await LanguageDetector.create({ expectedInputLanguages: LANGS.filter(l => l[0] !== "auto").map(l => l[0]) });
    const results = await detector.detect(text);
    detector.destroy?.();
    if (Array.isArray(results) && results.length > 0) {
      // results are likely sorted by confidence
      return results[0].detectedLanguage || null;
    }
  } catch (e) {
    console.warn("Language detection failed", e);
  }
  return null;
}
function getNextTargetLang(current) {
async function translateWithAutoFallback(sourceLanguage, initialTarget, text) {
  const codes = LANGS.map(l => l[0]).filter(c => c !== "auto");
  let usedTarget = initialTarget;
  const startIdx = Math.max(0, codes.indexOf(initialTarget));
  let translator = null;

  for (let step = 0; step < codes.length; step++) {
    if (step > 0) {
      usedTarget = codes[(startIdx + step) % codes.length];
      // 避免与来源语言完全一致的目标语言
      if (usedTarget === sourceLanguage) {
        continue;
      }
      targetSelect.value = usedTarget;
      setStatus("目标语言与来源语言冲突，已自动顺延为：" + usedTarget + "，正在重试...", "warn");
    }

    // 每次尝试前销毁上一实例
    translator?.destroy?.();


	    // 保护：即使是第一次循环也避免与来源语言相同
	    if (usedTarget === sourceLanguage) {
	      continue;
	    }

    const avail = await checkAvailability(sourceLanguage, usedTarget);
    const needMonitor = avail === "downloadable" || avail === "downloading";

    let progressShown = false;
    let showTimer = null;
    try {
      if (needMonitor) {
        translator = await Translator.create({
          sourceLanguage: normalizeLang(sourceLanguage),
          targetLanguage: normalizeLang(usedTarget),
          monitor(monitor) {
            monitor.addEventListener("downloadprogress", (e) => {
              const pct = Math.floor((e.loaded || 0) * 100);
              if (!progressShown) {
                if (pct >= 100) return;
                showTimer = setTimeout(() => {
                  downloadSection.classList.remove("hidden");
                  progressShown = true;
                  downloadProgress.value = pct;
                  downloadPct.textContent = `${pct}%`;
                }, 150);
              } else {
                downloadProgress.value = pct;
                downloadPct.textContent = `${pct}%`;
              }
            });
          },
        });
      } else {
        translator = await Translator.create({ sourceLanguage: normalizeLang(sourceLanguage), targetLanguage: normalizeLang(usedTarget) });
      }

      const translation = await translator.translate(text);
      return { translation, translator, usedTarget };
    } catch (e) {
      const msg = String(e?.message || e || "");
      // 仅在语言冲突时报错时继续顺延
      if (isPairUnsupported(msg)) {
        // 顺延到下一轮尝试
        continue;
      }
      // 非语言冲突错误，直接抛出
      throw e;
    } finally {
      if (typeof showTimer !== "undefined" && showTimer) clearTimeout(showTimer);
    }
  }

  // 全部尝试失败
  throw new Error("Unable to create translator for the given source and target language (after trying alternatives)");
}

  const codes = LANGS.map(l => l[0]).filter(c => c !== "auto");
  const idx = codes.indexOf(current);
  if (idx < 0) return codes[0] || null;
  return codes[(idx + 1) % codes.length] || null;
}


async function doTranslate() {
  outputEl.textContent = "";
  const text = inputEl.value.trim();
  if (!text) {
    setStatus("请输入要翻译的文本。", "warn");
    return;
  }

  const { hasTranslator, hasDetector } = featureDetect();
  if (!hasTranslator) {
    setStatus("当前浏览器不支持 Translator API（需要 Chrome 138+ 且安全上下文）。", "err");
    return;
  }

  translateBtn.disabled = true;
  translateBtn.classList.add('loading');
  setCopyEnabled(false);
  setStatus("正在准备翻译...", "");

  let sourceLanguage = sourceSelect.value;
  const targetLanguage = targetSelect.value;

  try {
    if (sourceLanguage === "auto") {
      const detected = await detectLanguageIfNeeded(text, hasDetector);
      if (detected) {
        sourceLanguage = detected;
        setStatus(`检测到来源语言：${detected}`, "ok");
      } else {
        setStatus("自动检测不可用；将回退为英文作为来源。", "warn");
        sourceLanguage = "en";
      }
    }

    const availability = await checkAvailability(sourceLanguage, targetLanguage);
    if (availability && availability !== "available") {
      setStatus(`模型可用性：${availability}。`, "warn");
    }

    // 如需下载模型时才显示进度条（避免已缓存时闪现100%）
    let translator;
    const needMonitor = availability === "downloadable" || availability === "downloading";
    let progressShown = false;

    let showTimer = null;
    let usedTarget = targetLanguage;

	    // 避免来源语言与目标语言相同导致不支持的语言对
	    if (sourceLanguage === usedTarget) {
	      const next = getNextTargetLang(usedTarget);
	      if (next && next !== usedTarget) {
	        usedTarget = next;
	        targetSelect.value = next;
	        setStatus("目标语言与来源语言相同，已自动顺延为：" + next + "，正在重试...", "warn");
	      } else {
	        throw new Error("The requested language options are not supported.");
	      }
	    }

    try {
      if (needMonitor) {
        translator = await Translator.create({
          sourceLanguage: normalizeLang(sourceLanguage),
          targetLanguage: normalizeLang(usedTarget),
          monitor(monitor) {
            monitor.addEventListener("downloadprogress", (e) => {
              const pct = Math.floor((e.loaded || 0) * 100);
              if (!progressShown) {
                if (pct >= 100) {
                  // 已经在本地或瞬时完成，不显示进度UI
                  return;
                }
                // 防止过快闪烁，延迟显示
                showTimer = setTimeout(() => {
                  downloadSection.classList.remove("hidden");
                  progressShown = true;
                  downloadProgress.value = pct;
                  downloadPct.textContent = `${pct}%`;
                }, 150);
              } else {
                downloadProgress.value = pct;
                downloadPct.textContent = `${pct}%`;
              }
            });
          },
        });
      } else {
        translator = await Translator.create({ sourceLanguage: normalizeLang(sourceLanguage), targetLanguage: normalizeLang(usedTarget) });
      }
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (isPairUnsupported(msg)) {
        const next = getNextTargetLang(usedTarget);
        if (next && next !== usedTarget) {
          usedTarget = next;
          targetSelect.value = next;
          setStatus("目标语言与来源语言冲突，已自动顺延为：" + next + "，正在重试...", "warn");
          // 为简化，顺延重试不启用进度监控
          translator = await Translator.create({ sourceLanguage, targetLanguage: usedTarget });
        } else {
          throw e;
        }
      } else {
        throw e;
      }
    }

    // 简单模式：翻译完成后隐藏进度

    let translation;
    try {
      translation = await translator.translate(text);
    } catch (e) {
      const msg = String(e?.message || e || "");
      if (isPairUnsupported(msg)) {
        // 顺延目标语言并重试一次
        const next = getNextTargetLang(targetLanguage);
        if (next && next !== targetLanguage) {
          targetSelect.value = next;
          setStatus("目标语言与来源语言冲突，已自动顺延为：" + next + "，正在重试...", "warn");
          // 重建 translator 并重试
          const avail2 = await checkAvailability(sourceLanguage, next);
          if (avail2 === "downloadable" || avail2 === "downloading") {
            translator = await Translator.create({ sourceLanguage: normalizeLang(sourceLanguage), targetLanguage: normalizeLang(next) });
          } else {
            translator = await Translator.create({ sourceLanguage: normalizeLang(sourceLanguage), targetLanguage: normalizeLang(next) });
          }
          translation = await translator.translate(text);
        } else {
          throw e;
        }

      // 绑定复制按钮（若存在）
      // avoid duplicate listener on retry
      copyBtn?.removeEventListener("click", copyOutput);
      copyBtn?.addEventListener("click", copyOutput);

      } else {
        throw e;
      }
    }

    outputEl.textContent = translation;
    const hasText = !!(translation && translation.trim());
    setCopyEnabled(hasText);

    // 绑定朗读与复制按钮（若存在）
    // avoid duplicate listeners
    speakBtn?.removeEventListener("click", speakOutput);
    speakBtn?.addEventListener("click", speakOutput);
    copyBtn?.removeEventListener("click", copyOutput);
    copyBtn?.addEventListener("click", copyOutput);

    setSpeakEnabled(hasText);

    const quota = translator.inputQuota;
    if (quota) {
      setStatus(`完成。剩余输入配额：${quota.remaining ?? "?"}/${quota.limit ?? "?"}`, "ok");
    } else {
      setStatus("完成。", "ok");
    }

    translator.destroy?.();

  } catch (err) {
    const msg = String(err?.message || err || "");
    if (isPairUnsupported(msg)) {
      setStatus("语言冲突，请更改为其他目标语言", "err");
    } else {
      setStatus(`错误：${msg}`, "err");
    }
  } finally {
    // 清理延迟显示定时器，隐藏/复位进度条
    if (typeof showTimer !== "undefined" && showTimer) clearTimeout(showTimer);
    downloadSection.classList.add("hidden");
    downloadProgress.value = 0;
    downloadPct.textContent = "0%";

    translateBtn.disabled = false;
    translateBtn.classList.remove('loading');
  }
}

populateLangSelects();
translateBtn.addEventListener("click", doTranslate);
// 交换来源与目标语言（若来源为自动检测，则目标在中英间切换，来源保持自动）
swapBtn?.addEventListener("click", () => {
  const prevSource = sourceSelect.value;
  const prevTarget = targetSelect.value;
  if (prevSource === "auto") {
    targetSelect.value = prevTarget === "zh-Hans" ? "en" : "zh-Hans";
  } else {
    sourceSelect.value = prevTarget;
    targetSelect.value = prevSource;
  }
  updateHints();
});

// 初始化：加载设置并同步 UI
(async () => {
  try {
    const s = await chrome.storage.sync.get(['autoTranslateEnabled', 'selectionTranslateEnabled', 'floatingButtonEnabled', 'autoTranslateTargetLang']);
    const autoEnabled = !!s.autoTranslateEnabled;
    const selectionEnabled = !!s.selectionTranslateEnabled;
    const floatingEnabled = !!s.floatingButtonEnabled;

    if (autoToggle) {
      autoToggle.checked = autoEnabled;
      updateToggleStatus(autoToggle, autoToggleStatus, autoEnabled);
    }
    if (selectionToggle) {
      selectionToggle.checked = selectionEnabled;
      updateToggleStatus(selectionToggle, selectionToggleStatus, selectionEnabled);
    }
    if (floatingToggle) {
      floatingToggle.checked = floatingEnabled;
      updateToggleStatus(floatingToggle, floatingToggleStatus, floatingEnabled);
    }
    if (s.autoTranslateTargetLang) targetSelect.value = s.autoTranslateTargetLang;
  } catch {}

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["contentScript.js"] });
      } catch {}
    }
  } catch {}
})();

// 自动翻译开关：持久化并提示
autoToggle?.addEventListener('change', async (e) => {
  const enabled = !!e.target.checked;
  await chrome.storage.sync.set({ autoTranslateEnabled: enabled, autoTranslateTargetLang: targetSelect.value });
  updateToggleStatus(autoToggle, autoToggleStatus, enabled);
  setStatus(enabled ? '已开启：自动翻译网页' : '已关闭：自动翻译网页', enabled ? 'ok' : '');
});

// 选中翻译开关：持久化并通知content script

selectionToggle?.addEventListener('change', async (e) => {
  const enabled = !!e.target.checked;
  await chrome.storage.sync.set({ selectionTranslateEnabled: enabled });
  updateToggleStatus(selectionToggle, selectionToggleStatus, enabled);
  setStatus(enabled ? '已开启：选中文本翻译' : '已关闭：选中文本翻译', enabled ? 'ok' : '');

  // 通知当前标签页的content script更新选中翻译状态
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'TOGGLE_SELECTION_TRANSLATION',
        enabled: enabled
      });
    }
  } catch (e) {
    // 忽略错误（可能是页面不支持或其他原因）
    console.warn('Failed to notify content script about selection translation toggle:', e);
  }
});

// 漂浮翻译按钮开关：持久化并通知content script
floatingToggle?.addEventListener('change', async (e) => {
  const enabled = !!e.target.checked;
  await chrome.storage.sync.set({ floatingButtonEnabled: enabled });
  updateToggleStatus(floatingToggle, floatingToggleStatus, enabled);
  setStatus(enabled ? '已开启：漂浮翻译按钮' : '已关闭：漂浮翻译按钮', enabled ? 'ok' : '');

  // 通知当前标签页的content script更新漂浮按钮状态
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'TOGGLE_FLOATING_BUTTON',
        enabled: enabled,
        targetLang: targetSelect.value
      });
    }
  } catch (e) {
    // 忽略错误（可能是页面不支持或其他原因）
    console.warn('Failed to notify content script about floating button toggle:', e);
  }
});

// 手动：翻译当前网页
manualPageBtn?.addEventListener('click', async () => {
  try {
    await chrome.storage.sync.set({ autoTranslateTargetLang: targetSelect.value });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["contentScript.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: 'START_PAGE_TRANSLATION', targetLang: targetSelect.value });
    setStatus('已翻译当前网页', 'ok');
  } catch (e) {
    setStatus('网页翻译失败：' + String(e?.message || e || ''), 'err');
  }
});

// 手动：恢复原状
restorePageBtn?.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await chrome.tabs.sendMessage(tab.id, { type: 'STOP_PAGE_TRANSLATION' });
    setStatus('已恢复原状', '');
  } catch (e) {
    setStatus('恢复失败：' + String(e?.message || e || ''), 'err');
  }
});

// 当目标语言改变时，保存设置；只有在自动翻译开启且页面已翻译时才实时切换
targetSelect?.addEventListener('change', async () => {
  await chrome.storage.sync.set({ autoTranslateTargetLang: targetSelect.value });

  // 只有在自动翻译开启时才自动翻译页面
  try {
    const settings = await chrome.storage.sync.get(['autoTranslateEnabled']);
    if (!settings.autoTranslateEnabled) {
      return; // 自动翻译未开启，不执行翻译
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // 检查页面是否已经在翻译状态
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'QUERY_STATUS' });
    if (response?.enabled) {
      // 页面已翻译，切换目标语言
      await chrome.tabs.sendMessage(tab.id, { type: 'START_PAGE_TRANSLATION', targetLang: targetSelect.value });
    }
  } catch (e) {
    // 忽略错误（可能是页面不支持或其他原因）
  }
});

// 反馈按钮：打开GitHub Issues页面
feedbackBtn?.addEventListener('click', () => {
  const feedbackUrl = 'https://github.com/AnYi-0/Translator/issues/';
  chrome.tabs.create({ url: feedbackUrl });
  setStatus('已打开GitHub反馈页面，感谢您的反馈！', 'ok');
});

// 邮箱反馈按钮：打开邮箱客户端
emailFeedbackBtn?.addEventListener('click', () => {
  const email = 'translator2025@163.com';
  const subject = encodeURIComponent('Translator插件反馈 - ');
  const body = encodeURIComponent(`您好！

请在下方描述您遇到的问题或建议：

问题描述：


重现步骤：
1. 
2. 
3. 

期望结果：


实际结果：


浏览器信息：
- Chrome版本：
- 插件版本：1.4.0
- 操作系统：

感谢您的反馈！`);
  
  const mailtoUrl = `mailto:${email}?subject=${subject}&body=${body}`;
  
  // 尝试直接打开邮箱客户端
  try {
    chrome.tabs.create({ url: mailtoUrl });
    setStatus('已打开邮箱客户端，感谢您的反馈！', 'ok');
  } catch (e) {
    // 如果直接打开失败，复制邮箱地址到剪贴板
    navigator.clipboard.writeText('translator2025@163.com').then(() => {
      setStatus('邮箱地址已复制到剪贴板：translator2025@163.com', 'ok');
    }).catch(() => {
      setStatus('请手动发送邮件至：translator2025@163.com', 'warn');
    });
  }
});

// Debug: Double-click feedback button to force show floating button
feedbackBtn?.addEventListener('dblclick', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, { type: 'FORCE_SHOW_FLOATING_BUTTON' });
      setStatus('已强制显示漂浮按钮（调试功能）', 'ok');
    }
  } catch (e) {
    setStatus('强制显示失败：' + String(e?.message || e || ''), 'err');
  }
});

// Optional: update availability hint when selects change
async function updateHints() {
  const src = sourceSelect.value === "auto" ? "en" : sourceSelect.value; // best-effort for hint
  const tgt = targetSelect.value;
  const avail = await checkAvailability(src, tgt);
  if (avail) setStatus(`模型可用性：${avail}`, "");
}
sourceSelect.addEventListener("change", updateHints);
targetSelect.addEventListener("change", updateHints);


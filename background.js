// background.js - MV3 service worker to support auto-translate on tab load

const KEY = {
  auto: 'autoTranslateEnabled',
  target: 'autoTranslateTargetLang',
  whitelist: 'whitelistPatterns',
};

// 检查URL是否在白名单中
function isUrlInWhitelist(url, patterns) {
  if (!patterns || patterns.length === 0) return false;
  
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const pathname = urlObj.pathname;
    const fullPath = hostname + pathname;
    
    for (const pattern of patterns) {
      try {
        // 支持通配符匹配
        if (pattern.includes('*')) {
          const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*');
          const regex = new RegExp('^' + regexPattern + '$');
          
          // 检查域名匹配
          if (regex.test(hostname)) {
            return true;
          }
          // 检查完整路径匹配
          if (regex.test(fullPath)) {
            return true;
          }
        } else {
          // 精确匹配：检查域名是否完全匹配或者完整路径匹配
          if (hostname === pattern || fullPath === pattern) {
            return true;
          }
        }
      } catch (e) {
        // 忽略无效的模式
        console.warn('无效的白名单模式:', pattern, e);
      }
    }
  } catch (e) {
    console.warn('URL解析失败:', url, e);
  }
  
  return false;
}

chrome.runtime.onInstalled.addListener(async () => {
  const s = await chrome.storage.sync.get([KEY.auto, KEY.target, KEY.whitelist]);
  if (typeof s[KEY.auto] === 'undefined') {
    await chrome.storage.sync.set({ [KEY.auto]: false });
  }
  if (typeof s[KEY.target] === 'undefined') {
    await chrome.storage.sync.set({ [KEY.target]: 'zh-Hans' });
  }
  if (typeof s[KEY.whitelist] === 'undefined') {
    await chrome.storage.sync.set({ [KEY.whitelist]: [] });
  }
});

// When a tab finishes loading and auto-translate is on, inject and start translation
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  try {
    const url = tab?.url || '';
    if (!/^https?:|^file:|^chrome-extension:/.test(url)) return;
    
    const s = await chrome.storage.sync.get([KEY.auto, KEY.target, KEY.whitelist]);
    if (!s[KEY.auto]) return;
    
    // 检查当前网址是否在白名单中
    const whitelistPatterns = s[KEY.whitelist] || [];
    if (isUrlInWhitelist(url, whitelistPatterns)) {
      console.log('当前网址在白名单中，跳过自动翻译:', url);
      return;
    }
    
    const targetLang = s[KEY.target] || 'zh-Hans';
    await chrome.scripting.executeScript({ target: { tabId }, files: ['contentScript.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'START_PAGE_TRANSLATION', targetLang: targetLang });
  } catch (e) {
    // ignore
  }
});


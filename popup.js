document.getElementById('start-audit').onclick = () => {
    chrome.runtime.sendMessage({ action: 'triggerAudit' });

    // Visual feedback
    const btn = document.getElementById('start-audit');
    const orig = btn.innerHTML;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;"><polyline points="20 6 9 17 4 12"/></svg> Reloading…`;
    btn.style.opacity = '0.7';
    btn.disabled = true;

    setTimeout(() => {
        btn.innerHTML = orig;
        btn.style.opacity = '1';
        btn.disabled = false;
    }, 1500);
};

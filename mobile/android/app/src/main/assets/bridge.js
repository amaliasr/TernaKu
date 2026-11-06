(() => {
  if (window.top !== window || !window.TernaKuAndroid) return;
  const native = window.TernaKuAndroid;
  native.onmessage = (event) => {
    window.dispatchEvent(new CustomEvent('ternaku:native-push', {detail: JSON.parse(event.data)}));
  };

  // Android's download manager cannot read the page's private blob URLs.
  const names = new Map();
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href.startsWith('blob:' + location.origin + '/')) names.set(this.href, this.download);
    return click.call(this);
  };
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[download]');
    if (link?.href.startsWith('blob:' + location.origin + '/')) names.set(link.href, link.download);
  }, true);
  window.__ternakuSaveBlob = async (url, reportedType) => {
    if (!url.startsWith('blob:' + location.origin + '/')) return;
    const filename = names.get(url) || 'TernaKu';
    names.delete(url);
    try {
      const blob = await (await fetch(url)).blob();
      const mime = blob.type || reportedType;
      if (!['application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(mime)) return;
      if (blob.size > 23 * 1024 * 1024) throw new Error();
      const reader = new FileReader();
      reader.onload = () => native.postMessage(JSON.stringify({
        action: 'save-document', mime, filename, data: reader.result.split(',')[1],
      }));
      reader.readAsDataURL(blob);
    } catch {
      alert('Berkas belum dapat disimpan. Untuk laporan besar, pilih rentang tanggal yang lebih pendek.');
    }
  };
})();

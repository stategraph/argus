(function() {
  fetch('/api/notifications/count')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.count > 0) {
        var badge = document.getElementById('notification-badge');
        if (badge) {
          badge.textContent = data.count;
          badge.classList.remove('hidden');
        }
      }
    })
    .catch(function() {});
})();

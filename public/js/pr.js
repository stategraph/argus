// PR Page JavaScript
// Handles polling, inline comments, and diff loading

(function() {
  'use strict';

  const config = window.ARGUS_CONFIG;
  if (!config) {
    console.error('ARGUS_CONFIG not found');
    return;
  }

  // State
  let pollingInterval = null;
  let lastKnownHeadSha = config.headSha;

  // DOM Elements
  const updatesBanner = document.getElementById('updates-banner');
  const reloadLink = document.getElementById('reload-link');
  const dismissBannerBtn = document.getElementById('dismiss-banner');
  const checkUpdatesBtn = document.getElementById('check-updates-btn');
  const currentHeadShaEl = document.getElementById('current-head-sha');
  const fetchedAtEl = document.getElementById('fetched-at');
  const diffContainer = document.getElementById('diff-container');
  const pollIntervalTextEl = document.getElementById('poll-interval-text');

  // Initialize
  init();

  function init() {
    // Set up event listeners
    setupPolling();
    setupSidebarLinks();
    setupInlineComments();
    setupLoadFullDiff();
    setupCommentControls();

    // Dismiss banner
    if (dismissBannerBtn) {
      dismissBannerBtn.addEventListener('click', () => {
        updatesBanner.classList.add('hidden');
      });
    }

    // Check updates button
    if (checkUpdatesBtn) {
      checkUpdatesBtn.addEventListener('click', checkForUpdates);
    }

    // Reload link
    if (reloadLink) {
      reloadLink.href = window.location.href;
    }
  }

  // Polling for updates
  function setupPolling() {
    if (config.pollIntervalMs > 0) {
      pollingInterval = setInterval(checkForUpdates, config.pollIntervalMs);
    } else if (pollIntervalTextEl) {
      pollIntervalTextEl.textContent = 'Auto-check disabled';
    }
  }

  async function checkForUpdates() {
    // Visual feedback
    if (checkUpdatesBtn) {
      checkUpdatesBtn.textContent = 'Checking...';
      checkUpdatesBtn.disabled = true;
    }

    try {
      const url = `/pr/${config.owner}/${config.repo}/${config.prNumber}/head`;
      const response = await fetch(url);

      if (!response.ok) {
        console.warn('Failed to check for updates:', response.status);
        if (checkUpdatesBtn) {
          checkUpdatesBtn.textContent = 'Check failed';
          setTimeout(() => {
            checkUpdatesBtn.textContent = 'Check for updates';
            checkUpdatesBtn.disabled = false;
          }, 2000);
        }
        return;
      }

      const data = await response.json();

      if (data.head_sha && data.head_sha !== lastKnownHeadSha) {
        showUpdatesBanner();
        if (checkUpdatesBtn) {
          checkUpdatesBtn.textContent = 'Updates available!';
        }
        if (pollIntervalTextEl) {
          pollIntervalTextEl.textContent = 'Updates available';
        }
        // Stop polling after update detected
        if (pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
        }
      } else {
        // No updates
        if (checkUpdatesBtn) {
          checkUpdatesBtn.textContent = 'Up to date';
          setTimeout(() => {
            checkUpdatesBtn.textContent = 'Check for updates';
            checkUpdatesBtn.disabled = false;
          }, 2000);
        }
      }
    } catch (err) {
      console.error('Error checking for updates:', err);
      if (checkUpdatesBtn) {
        checkUpdatesBtn.textContent = 'Check failed';
        setTimeout(() => {
          checkUpdatesBtn.textContent = 'Check for updates';
          checkUpdatesBtn.disabled = false;
        }, 2000);
      }
    }
  }

  function showUpdatesBanner() {
    if (updatesBanner) {
      updatesBanner.classList.remove('hidden');
    }
  }

  // Sidebar links
  function setupSidebarLinks() {
    const sidebarItems = document.querySelectorAll('.file-sidebar-item');

    sidebarItems.forEach((item, index) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();

        // Highlight file
        const files = diffContainer.querySelectorAll('.diff-file');
        files.forEach((f, i) => {
          f.classList.toggle('highlighted', i === index);
        });

        // Scroll to file
        const targetFile = files[index];
        if (targetFile) {
          // Ensure file is expanded (details element)
          targetFile.open = true;
          targetFile.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        // Update sidebar active state
        sidebarItems.forEach((sidebarItem, i) => {
          sidebarItem.classList.toggle('active', i === index);
        });
      });
    });
  }

  // Inline comments
  function setupInlineComments() {
    // Handle click on inline comment buttons
    diffContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.line-comment-btn');
      if (!btn) return;

      e.preventDefault(); // Prevent scroll to anchor

      const formId = btn.getAttribute('href').substring(1);
      const formRow = document.getElementById(formId);
      if (formRow) {
        // Hide any other open forms
        document.querySelectorAll('.inline-comment-form-row.visible').forEach(row => {
          row.classList.remove('visible');
        });

        // Show this form
        formRow.classList.add('visible');

        // Focus textarea
        const textarea = formRow.querySelector('textarea');
        if (textarea) {
          textarea.focus();
        }
      }
    });

    // Handle cancel buttons
    diffContainer.addEventListener('click', (e) => {
      const cancelBtn = e.target.closest('.comment-form-close, .inline-comment-form .btn-secondary');
      if (!cancelBtn) return;

      e.preventDefault();

      // Find and hide the form row
      const formRow = cancelBtn.closest('.inline-comment-form-row');
      if (formRow) {
        formRow.classList.remove('visible');
        // Clear the textarea
        const textarea = formRow.querySelector('textarea');
        if (textarea) {
          textarea.value = '';
        }
      }

      // Also clear hash if present
      if (window.location.hash) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    });
  }

  // Load full diff
  function setupLoadFullDiff() {
    diffContainer.addEventListener('click', async (e) => {
      const btn = e.target.closest('.load-full-diff');
      if (!btn) return;

      e.preventDefault();

      const path = btn.dataset.path;
      if (!path) return;

      // Find the file element
      const fileEl = btn.closest('.diff-file');
      if (!fileEl) return;

      // Show loading state
      btn.textContent = 'Loading...';
      btn.disabled = true;

      try {
        const url = `/pr/${config.owner}/${config.repo}/${config.prNumber}/file?path=${encodeURIComponent(path)}`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error('Failed to load diff');
        }

        const html = await response.text();

        // Replace the file element with the new HTML
        const temp = document.createElement('div');
        temp.innerHTML = html;
        const newFileEl = temp.firstElementChild;

        if (newFileEl) {
          fileEl.replaceWith(newFileEl);
        }
      } catch (err) {
        console.error('Error loading full diff:', err);
        btn.textContent = 'Load full diff (failed, retry)';
        btn.disabled = false;
      }
    });
  }

  // Expand/collapse all comments
  function setupCommentControls() {
    const expandAllBtn = document.getElementById('expand-all-comments');
    const collapseAllBtn = document.getElementById('collapse-all-comments');

    if (expandAllBtn) {
      expandAllBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const commentsList = document.querySelector('.comments-list');
        if (commentsList) {
          const allComments = commentsList.querySelectorAll('details.comment, details.review');
          allComments.forEach(comment => {
            comment.open = true;
          });
        }
      });
    }

    if (collapseAllBtn) {
      collapseAllBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const commentsList = document.querySelector('.comments-list');
        if (commentsList) {
          const allComments = commentsList.querySelectorAll('details.comment, details.review');
          allComments.forEach(comment => {
            comment.open = false;
          });
        }
      });
    }
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }
  });
})();

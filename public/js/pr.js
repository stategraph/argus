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
    setupReplyButtons();
    setupVimBindings();

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

  // Reply to comments
  function setupReplyButtons() {
    const replyButtons = document.querySelectorAll('.reply-to-comment');
    const commentForm = document.querySelector('.pr-comment-form textarea[name="body"]');

    if (!commentForm) return;

    replyButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        const author = button.getAttribute('data-author');
        const body = button.getAttribute('data-body');
        const shouldQuote = button.getAttribute('data-quote') === 'true';

        let replyText;

        if (shouldQuote && body) {
          // Create quoted reply
          const quotedLines = body.split('\\n').map(line => `> ${line}`).join('\n');
          replyText = `@${author}\n\n${quotedLines}\n\n`;
        } else {
          // Simple mention reply
          replyText = `@${author} `;
        }

        // Set the form value and focus
        commentForm.value = replyText;
        commentForm.focus();

        // Scroll to the comment form
        commentForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }

  // Vim key bindings
  function setupVimBindings() {
    let lastKeyTime = 0;
    let lastKey = '';

    // Get tab navigation elements
    const tabs = Array.from(document.querySelectorAll('.pr-tab'));
    const getCurrentTab = () => tabs.findIndex(tab => tab.classList.contains('active'));

    const switchTab = (index) => {
      if (index >= 0 && index < tabs.length) {
        tabs[index].click();
      }
    };

    // Get files in Files tab
    const getFiles = () => Array.from(document.querySelectorAll('.diff-file'));
    const getCommits = () => Array.from(document.querySelectorAll('.commit-item'));

    let selectedFileIndex = 0;
    let selectedCommitIndex = 0;

    const highlightFile = (index) => {
      const files = getFiles();
      if (files.length === 0) return;

      // Clamp index
      selectedFileIndex = Math.max(0, Math.min(index, files.length - 1));

      // Remove previous highlight
      files.forEach(f => f.classList.remove('vim-selected'));

      // Add highlight
      const file = files[selectedFileIndex];
      file.classList.add('vim-selected');
      file.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const highlightCommit = (index) => {
      const commits = getCommits();
      if (commits.length === 0) return;

      // Clamp index
      selectedCommitIndex = Math.max(0, Math.min(index, commits.length - 1));

      // Remove previous highlight
      commits.forEach(c => c.classList.remove('vim-selected'));

      // Add highlight
      const commit = commits[selectedCommitIndex];
      commit.classList.add('vim-selected');
      commit.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    document.addEventListener('keydown', (e) => {
      // Don't intercept if user is typing in a form element
      if (e.target.matches('input, textarea, select')) {
        return;
      }

      const key = e.key.toLowerCase();
      const now = Date.now();
      const timeSinceLastKey = now - lastKeyTime;

      // Handle 'gg' for go to top
      if (lastKey === 'g' && key === 'g' && timeSinceLastKey < 500) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        lastKey = '';
        return;
      }

      lastKey = key;
      lastKeyTime = now;

      // Tab navigation with h/l
      if (key === 'h' || key === 'arrowleft') {
        e.preventDefault();
        const current = getCurrentTab();
        switchTab(current - 1);
        return;
      }

      if (key === 'l' || key === 'arrowright') {
        e.preventDefault();
        const current = getCurrentTab();
        switchTab(current + 1);
        return;
      }

      // Direct tab shortcuts
      if (key === 'c') {
        e.preventDefault();
        switchTab(0); // Conversation
        return;
      }

      if (key === 'm') {
        e.preventDefault();
        switchTab(1); // Commits
        return;
      }

      if (key === 'f') {
        e.preventDefault();
        switchTab(2); // Files
        return;
      }

      // Reload page
      if (key === 'r') {
        e.preventDefault();
        window.location.reload();
        return;
      }

      // Go to bottom
      if (key === 'g' && e.shiftKey) {
        e.preventDefault();
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        lastKey = '';
        return;
      }

      // File/Commit navigation
      const currentTab = getCurrentTab();

      // In Files tab (index 2)
      if (currentTab === 2) {
        if (key === 'j' || key === 'arrowdown') {
          e.preventDefault();
          highlightFile(selectedFileIndex + 1);
          return;
        }

        if (key === 'k' || key === 'arrowup') {
          e.preventDefault();
          highlightFile(selectedFileIndex - 1);
          return;
        }

        if (key === 'o' || key === 'enter') {
          e.preventDefault();
          const files = getFiles();
          if (files[selectedFileIndex]) {
            const details = files[selectedFileIndex];
            details.open = !details.open;
          }
          return;
        }
      }

      // In Commits tab (index 1)
      if (currentTab === 1) {
        if (key === 'j' || key === 'arrowdown') {
          e.preventDefault();
          highlightCommit(selectedCommitIndex + 1);
          return;
        }

        if (key === 'k' || key === 'arrowup') {
          e.preventDefault();
          highlightCommit(selectedCommitIndex - 1);
          return;
        }

        if (key === 'enter') {
          e.preventDefault();
          const commits = getCommits();
          if (commits[selectedCommitIndex]) {
            const link = commits[selectedCommitIndex].querySelector('a');
            if (link) {
              link.click();
            }
          }
          return;
        }
      }
    });

    // Reset selection index on tab switch (but don't auto-highlight)
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        if (index === 2) {
          selectedFileIndex = 0;
        } else if (index === 1) {
          selectedCommitIndex = 0;
        }
      });
    });
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }
  });
})();

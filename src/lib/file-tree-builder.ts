/**
 * File Tree Builder
 * Builds a hierarchical tree structure from flat file lists for collapsible directory views
 */

export interface FileNode {
  type: 'file';
  path: string;
  name: string;
  fileIndex: number;
  fileData: any;
}

export interface DirectoryNode {
  type: 'directory';
  path: string;
  name: string;
  children: Map<string, FileNode | DirectoryNode>;
  stats: { totalFiles: number; additions: number; deletions: number };
}

/**
 * Build a hierarchical tree structure from a flat list of files
 */
export function buildFileTree(files: Array<{ path: string; file: any; [key: string]: any }>): DirectoryNode {
  const root: DirectoryNode = {
    type: 'directory',
    path: '',
    name: 'root',
    children: new Map(),
    stats: { totalFiles: 0, additions: 0, deletions: 0 },
  };

  files.forEach((fileData, index) => {
    const parts = fileData.path.split('/');
    let current = root;

    // Navigate/create directory nodes
    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i];
      const dirPath = parts.slice(0, i + 1).join('/');

      if (!current.children.has(dirName)) {
        current.children.set(dirName, {
          type: 'directory',
          path: dirPath,
          name: dirName,
          children: new Map(),
          stats: { totalFiles: 0, additions: 0, deletions: 0 },
        });
      }
      current = current.children.get(dirName) as DirectoryNode;
    }

    // Add file node
    const fileName = parts[parts.length - 1];
    current.children.set(fileName, {
      type: 'file',
      path: fileData.path,
      name: fileName,
      fileIndex: index,
      fileData,
    });

    // Bubble up stats to all parent directories
    const additions = fileData.file?.additions || 0;
    const deletions = fileData.file?.deletions || 0;

    let node: DirectoryNode | null = current;
    const visited = new Set<string>();

    while (node && node !== root) {
      // Prevent infinite loops
      if (visited.has(node.path)) break;
      visited.add(node.path);

      node.stats.totalFiles++;
      node.stats.additions += additions;
      node.stats.deletions += deletions;

      // Find parent
      const parentPath = node.path.split('/').slice(0, -1).join('/');
      node = findNodeByPath(root, parentPath);
    }

    // Update root stats
    root.stats.totalFiles++;
    root.stats.additions += additions;
    root.stats.deletions += deletions;
  });

  return root;
}

/**
 * Find a directory node by its path
 */
function findNodeByPath(root: DirectoryNode, path: string): DirectoryNode | null {
  if (!path || path === root.path) return root;

  const parts = path.split('/');
  let current: DirectoryNode | FileNode = root;

  for (const part of parts) {
    if (current.type !== 'directory') return null;
    const child = current.children.get(part);
    if (!child) return null;
    current = child;
  }

  return current.type === 'directory' ? current : null;
}

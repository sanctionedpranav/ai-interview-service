/**
 * DSA Keywords for STT Recognition
 * These keywords are used to bias the Whisper STT model towards correct
 * recognition of data structure and algorithm terminology
 */

export const dsaKeywords = {
  // Sorting Algorithms
  sorting: [
    'bubble sort',
    'selection sort',
    'insertion sort',
    'merge sort',
    'quick sort',
    'heap sort',
    'radix sort',
    'counting sort',
    'bucket sort',
    'shell sort',
    'cocktail sort',
    'tim sort',
  ],

  // Searching Algorithms
  searching: [
    'linear search',
    'binary search',
    'depth first search',
    'breadth first search',
    'DFS',
    'BFS',
  ],

  // Graph Algorithms
  graph: [
    'Dijkstra',
    'Bellman Ford',
    'Floyd Warshall',
    'Prim',
    'Kruskal',
    'topological sort',
    'strongly connected components',
    'SCC',
    'minimum spanning tree',
    'MST',
    'adjacency list',
    'adjacency matrix',
  ],

  // Tree Algorithms
  tree: [
    'binary search tree',
    'BST',
    'AVL tree',
    'red black tree',
    'B tree',
    'segment tree',
    'Fenwick tree',
    'trie',
    'suffix tree',
    'balanced tree',
    'in-order traversal',
    'pre-order traversal',
    'post-order traversal',
    'level order traversal',
  ],

  // String Algorithms
  string: [
    'KMP algorithm',
    'Boyer Moore',
    'Rabin Karp',
    'Z algorithm',
    'Aho Corasick',
    'suffix array',
    'palindrome',
    'anagram',
    'substring',
  ],

  // Dynamic Programming
  dynamicProgramming: [
    'dynamic programming',
    'DP',
    'memoization',
    'tabulation',
    'longest common subsequence',
    'LCS',
    'longest increasing subsequence',
    'LIS',
    'edit distance',
    'knapsack problem',
    'coin change',
    'matrix chain multiplication',
  ],

  // Data Structures
  dataStructures: [
    'array',
    'linked list',
    'doubly linked list',
    'circular linked list',
    'stack',
    'queue',
    'priority queue',
    'deque',
    'hash table',
    'hash map',
    'hash set',
    'heap',
    'min heap',
    'max heap',
    'binary tree',
    'tree',
    'graph',
    'directed graph',
    'undirected graph',
    'weighted graph',
    'unweighted graph',
    'union find',
    'disjoint set',
    'bloom filter',
    'skip list',
  ],

  // Complexity & Analysis
  complexity: [
    'Big O',
    'Big Omega',
    'Big Theta',
    'time complexity',
    'space complexity',
    'asymptotic',
    'constant time',
    'linear time',
    'quadratic time',
    'logarithmic time',
    'exponential time',
  ],

  // Problem Types
  problemTypes: [
    'two pointer',
    'sliding window',
    'backtracking',
    'greedy algorithm',
    'divide and conquer',
    'recursion',
    'bit manipulation',
    'number theory',
    'combinatorics',
  ],

  // Common Terms
  commonTerms: [
    'iteration',
    'recursion',
    'base case',
    'recursive case',
    'pivot',
    'partition',
    'swap',
    'pointer',
    'node',
    'edge',
    'vertex',
    'root',
    'leaf',
    'depth',
    'height',
    'traversal',
    'rotation',
    'balance',
    'collision',
    'collision resolution',
    'chaining',
    'open addressing',
  ],
};

/**
 * Generate STT prompt with DSA keywords
 * @param {string} jobRole - The job role or specialization
 * @returns {string} Formatted prompt for STT biasing
 */
export function generateSttPrompt(jobRole = 'developer') {
  const allKeywords = Object.values(dsaKeywords).flat();
  const keywordString = allKeywords.join(', ');

  return `Technical software engineering interview for ${jobRole}. 
Topics: programming, data structures, algorithms, system design, frontend, backend, API, React, Node.js, Javascript, databases, scalability, cloud, AWS, UI, UX.
DSA Keywords: ${keywordString}.
Candidate naturally answering technical questions about algorithms, data structures, and problem solving.`;
}

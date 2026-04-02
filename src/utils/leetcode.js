/**
 * LeetCode Problem Reference Database
 *
 * Maps problem numbers to their title, difficulty, topic, and a brief description.
 * When an admin writes "LeetCode 29" in a chapter prompt, the system expands it
 * automatically so the AI knows exactly what that problem is.
 *
 * Coverage: Top ~150 classic problems + all major interview favorites.
 */

export const LEETCODE_PROBLEMS = {
  1:   { title: 'Two Sum', difficulty: 'Easy', tags: ['Array', 'Hash Table'], description: 'Given an array of integers and a target, return indices of two numbers that add up to the target.' },
  2:   { title: 'Add Two Numbers', difficulty: 'Medium', tags: ['Linked List', 'Math'], description: 'Add two numbers represented as reversed linked lists and return the result as a linked list.' },
  3:   { title: 'Longest Substring Without Repeating Characters', difficulty: 'Medium', tags: ['Sliding Window', 'Hash Table'], description: 'Find the length of the longest substring that contains no repeating characters.' },
  4:   { title: 'Median of Two Sorted Arrays', difficulty: 'Hard', tags: ['Binary Search', 'Array'], description: 'Find the median of two sorted arrays in O(log(m+n)) time.' },
  5:   { title: 'Longest Palindromic Substring', difficulty: 'Medium', tags: ['String', 'DP'], description: 'Given a string, return the longest palindromic substring.' },
  7:   { title: 'Reverse Integer', difficulty: 'Medium', tags: ['Math'], description: 'Reverse the digits of a 32-bit signed integer. Return 0 if the result overflows.' },
  9:   { title: 'Palindrome Number', difficulty: 'Easy', tags: ['Math'], description: 'Determine whether an integer is a palindrome without converting it to a string.' },
  11:  { title: 'Container With Most Water', difficulty: 'Medium', tags: ['Two Pointers', 'Array'], description: 'Find two lines that together with the x-axis form a container that holds the most water.' },
  13:  { title: 'Roman to Integer', difficulty: 'Easy', tags: ['String', 'Math'], description: 'Convert a Roman numeral string to an integer.' },
  14:  { title: 'Longest Common Prefix', difficulty: 'Easy', tags: ['String'], description: 'Find the longest common prefix string among an array of strings.' },
  15:  { title: 'Three Sum', difficulty: 'Medium', tags: ['Two Pointers', 'Array'], description: 'Find all unique triplets in an array that sum to zero.' },
  17:  { title: 'Letter Combinations of a Phone Number', difficulty: 'Medium', tags: ['Backtracking', 'String'], description: 'Return all possible letter combinations a phone number could represent.' },
  19:  { title: 'Remove Nth Node From End of List', difficulty: 'Medium', tags: ['Linked List', 'Two Pointers'], description: 'Remove the nth node from the end of a linked list and return its head.' },
  20:  { title: 'Valid Parentheses', difficulty: 'Easy', tags: ['Stack', 'String'], description: 'Determine if a string of brackets is valid — every open bracket must be closed in the correct order.' },
  21:  { title: 'Merge Two Sorted Lists', difficulty: 'Easy', tags: ['Linked List'], description: 'Merge two sorted linked lists and return the merged list as a new sorted list.' },
  22:  { title: 'Generate Parentheses', difficulty: 'Medium', tags: ['Backtracking', 'String'], description: 'Generate all combinations of well-formed parentheses of n pairs.' },
  23:  { title: 'Merge K Sorted Lists', difficulty: 'Hard', tags: ['Linked List', 'Heap'], description: 'Merge k sorted linked lists and return one sorted list using a priority queue.' },
  24:  { title: 'Swap Nodes in Pairs', difficulty: 'Medium', tags: ['Linked List'], description: 'Given a linked list, swap every two adjacent nodes and return the head.' },
  26:  { title: 'Remove Duplicates from Sorted Array', difficulty: 'Easy', tags: ['Array', 'Two Pointers'], description: 'Remove duplicates in-place from a sorted array and return the new length.' },
  28:  { title: 'Find the Index of the First Occurrence in a String', difficulty: 'Easy', tags: ['String', 'Two Pointers'], description: 'Return the index of the first occurrence of needle in haystack, or -1 if not present.' },
  29:  { title: 'Divide Two Integers', difficulty: 'Medium', tags: ['Math', 'Bit Manipulation'], description: 'Divide two integers without using multiplication, division, or mod operators. Handle overflow and sign.' },
  33:  { title: 'Search in Rotated Sorted Array', difficulty: 'Medium', tags: ['Binary Search', 'Array'], description: 'Search for a target in a rotated sorted array in O(log n) time.' },
  34:  { title: 'Find First and Last Position of Element in Sorted Array', difficulty: 'Medium', tags: ['Binary Search'], description: 'Find the starting and ending position of a target value in a sorted array.' },
  35:  { title: 'Search Insert Position', difficulty: 'Easy', tags: ['Binary Search'], description: 'Given a sorted array and a target, return the index to insert the target.' },
  36:  { title: 'Valid Sudoku', difficulty: 'Medium', tags: ['Array', 'Hash Table'], description: 'Determine if a 9x9 Sudoku board is valid by checking rows, columns, and 3x3 boxes.' },
  39:  { title: 'Combination Sum', difficulty: 'Medium', tags: ['Backtracking', 'Array'], description: 'Find all unique combinations of candidates where chosen numbers sum to target (reuse allowed).' },
  42:  { title: 'Trapping Rain Water', difficulty: 'Hard', tags: ['Two Pointers', 'Stack', 'DP'], description: 'Compute how much water can be trapped between bars of given heights.' },
  46:  { title: 'Permutations', difficulty: 'Medium', tags: ['Backtracking'], description: 'Return all possible permutations of a distinct integer array.' },
  48:  { title: 'Rotate Image', difficulty: 'Medium', tags: ['Array', 'Matrix'], description: 'Rotate an n×n matrix 90 degrees clockwise in-place.' },
  49:  { title: 'Group Anagrams', difficulty: 'Medium', tags: ['String', 'Hash Table'], description: 'Group an array of strings into sub-arrays of anagrams together.' },
  51:  { title: 'N-Queens', difficulty: 'Hard', tags: ['Backtracking'], description: 'Place n queens on an n×n chessboard such that no two queens attack each other. Return all solutions.' },
  53:  { title: 'Maximum Subarray', difficulty: 'Medium', tags: ['DP', 'Array'], description: 'Find the contiguous subarray with the largest sum (Kadane\'s Algorithm).' },
  54:  { title: 'Spiral Matrix', difficulty: 'Medium', tags: ['Array', 'Matrix'], description: 'Return all elements of a matrix in spiral order.' },
  55:  { title: 'Jump Game', difficulty: 'Medium', tags: ['Greedy', 'Array'], description: 'Given jump lengths at each index, determine if you can reach the last index.' },
  56:  { title: 'Merge Intervals', difficulty: 'Medium', tags: ['Array', 'Sorting'], description: 'Merge all overlapping intervals and return an array of the non-overlapping intervals.' },
  57:  { title: 'Insert Interval', difficulty: 'Medium', tags: ['Array'], description: 'Insert a new interval into a sorted list of non-overlapping intervals and merge if necessary.' },
  62:  { title: 'Unique Paths', difficulty: 'Medium', tags: ['DP', 'Math'], description: 'A robot moves in an m×n grid from top-left to bottom-right — count unique paths (only right or down moves).' },
  70:  { title: 'Climbing Stairs', difficulty: 'Easy', tags: ['DP', 'Math'], description: 'Count the number of distinct ways to climb n stairs, taking 1 or 2 steps at a time.' },
  72:  { title: 'Edit Distance', difficulty: 'Hard', tags: ['DP', 'String'], description: 'Find the minimum number of operations (insert, delete, replace) to convert one string to another.' },
  73:  { title: 'Set Matrix Zeroes', difficulty: 'Medium', tags: ['Array', 'Matrix'], description: 'If an element in an m×n matrix is 0, set the entire row and column to 0 in-place.' },
  74:  { title: 'Search a 2D Matrix', difficulty: 'Medium', tags: ['Binary Search', 'Matrix'], description: 'Search for a target in a sorted m×n matrix where rows and columns are sorted.' },
  75:  { title: 'Sort Colors', difficulty: 'Medium', tags: ['Two Pointers', 'Array'], description: 'Sort an array of 0s, 1s, and 2s in-place without using sort() (Dutch National Flag problem).' },
  76:  { title: 'Minimum Window Substring', difficulty: 'Hard', tags: ['Sliding Window', 'String'], description: 'Find the minimum window in string s that contains all characters of string t.' },
  78:  { title: 'Subsets', difficulty: 'Medium', tags: ['Backtracking', 'Array'], description: 'Return all possible subsets (power set) of an integer array.' },
  79:  { title: 'Word Search', difficulty: 'Medium', tags: ['Backtracking', 'DFS', 'Matrix'], description: 'Given a 2D board and a word, return true if the word exists in the grid using adjacent cells.' },
  84:  { title: 'Largest Rectangle in Histogram', difficulty: 'Hard', tags: ['Stack', 'Array'], description: 'Find the largest rectangle that can fit in a histogram given bar heights.' },
  88:  { title: 'Merge Sorted Array', difficulty: 'Easy', tags: ['Array', 'Two Pointers'], description: 'Merge two sorted arrays nums1 and nums2 into nums1 in-place.' },
  91:  { title: 'Decode Ways', difficulty: 'Medium', tags: ['DP', 'String'], description: 'Count the number of ways to decode a string of digits into letters (A=1...Z=26).' },
  94:  { title: 'Binary Tree Inorder Traversal', difficulty: 'Easy', tags: ['Tree', 'DFS', 'Stack'], description: 'Return the inorder traversal of a binary tree\'s node values.' },
  98:  { title: 'Validate Binary Search Tree', difficulty: 'Medium', tags: ['Tree', 'DFS'], description: 'Determine if a binary tree is a valid binary search tree.' },
  100: { title: 'Same Tree', difficulty: 'Easy', tags: ['Tree', 'DFS'], description: 'Given roots of two binary trees, check if they are structurally identical with same values.' },
  101: { title: 'Symmetric Tree', difficulty: 'Easy', tags: ['Tree', 'BFS'], description: 'Check whether a binary tree is a mirror of itself (symmetric around its center).' },
  102: { title: 'Binary Tree Level Order Traversal', difficulty: 'Medium', tags: ['Tree', 'BFS'], description: 'Return the level-order traversal of a binary tree\'s nodes as a list of lists.' },
  104: { title: 'Maximum Depth of Binary Tree', difficulty: 'Easy', tags: ['Tree', 'DFS'], description: 'Find the maximum depth (number of nodes along the longest path from root to leaf).' },
  105: { title: 'Construct Binary Tree from Preorder and Inorder Traversal', difficulty: 'Medium', tags: ['Tree', 'DFS'], description: 'Build a binary tree given its preorder and inorder traversal arrays.' },
  110: { title: 'Balanced Binary Tree', difficulty: 'Easy', tags: ['Tree', 'DFS'], description: 'Determine if a binary tree is height-balanced (no subtree differs in height by more than 1).' },
  112: { title: 'Path Sum', difficulty: 'Easy', tags: ['Tree', 'DFS'], description: 'Check if a root-to-leaf path in the binary tree has a sum equal to targetSum.' },
  116: { title: 'Populating Next Right Pointers in Each Node', difficulty: 'Medium', tags: ['Tree', 'BFS'], description: 'Populate each node\'s next pointer to point to its next right node in a perfect binary tree.' },
  118: { title: 'Pascal\'s Triangle', difficulty: 'Easy', tags: ['Array', 'DP'], description: 'Generate the first numRows of Pascal\'s triangle.' },
  121: { title: 'Best Time to Buy and Sell Stock', difficulty: 'Easy', tags: ['Array', 'DP'], description: 'Find the maximum profit from one buy-sell transaction.' },
  124: { title: 'Binary Tree Maximum Path Sum', difficulty: 'Hard', tags: ['Tree', 'DFS', 'DP'], description: 'Find the maximum path sum in a binary tree where the path can start and end at any node.' },
  125: { title: 'Valid Palindrome', difficulty: 'Easy', tags: ['String', 'Two Pointers'], description: 'Check if a string is a palindrome considering only alphanumeric characters.' },
  127: { title: 'Word Ladder', difficulty: 'Hard', tags: ['BFS', 'String'], description: 'Find the shortest transformation sequence from beginWord to endWord changing one letter at a time.' },
  128: { title: 'Longest Consecutive Sequence', difficulty: 'Medium', tags: ['Array', 'Hash Table'], description: 'Find the longest streak of consecutive integers in an unsorted array in O(n) time.' },
  130: { title: 'Surrounded Regions', difficulty: 'Medium', tags: ['DFS', 'BFS', 'Matrix'], description: 'Capture surrounded regions by replacing \'O\'s enclosed by \'X\'s with \'X\'s.' },
  131: { title: 'Palindrome Partitioning', difficulty: 'Medium', tags: ['Backtracking', 'DP'], description: 'Partition a string such that every substring is a palindrome. Return all possible partitions.' },
  136: { title: 'Single Number', difficulty: 'Easy', tags: ['Bit Manipulation', 'Array'], description: 'Find the element that does not have a duplicate in an array (every other appears twice). Use XOR.' },
  138: { title: 'Copy List with Random Pointer', difficulty: 'Medium', tags: ['Linked List', 'Hash Table'], description: 'Deep copy a linked list where each node has a next and a random pointer.' },
  139: { title: 'Word Break', difficulty: 'Medium', tags: ['DP', 'String'], description: 'Determine if a string can be segmented into words from a given dictionary.' },
  141: { title: 'Linked List Cycle', difficulty: 'Easy', tags: ['Linked List', 'Two Pointers'], description: 'Detect if a linked list has a cycle using Floyd\'s tortoise-and-hare algorithm.' },
  142: { title: 'Linked List Cycle II', difficulty: 'Medium', tags: ['Linked List', 'Two Pointers'], description: 'Find the node where a cycle begins in a linked list.' },
  143: { title: 'Reorder List', difficulty: 'Medium', tags: ['Linked List', 'Two Pointers'], description: 'Reorder a linked list so that nodes are interleaved with the last half reversed.' },
  146: { title: 'LRU Cache', difficulty: 'Medium', tags: ['Design', 'Linked List', 'Hash Table'], description: 'Design a data structure that follows the LRU cache policy in O(1) time for get and put.' },
  148: { title: 'Sort List', difficulty: 'Medium', tags: ['Linked List', 'Sorting'], description: 'Sort a linked list in O(n log n) time using merge sort.' },
  149: { title: 'Max Points on a Line', difficulty: 'Hard', tags: ['Math', 'Hash Table'], description: 'Find the maximum number of points that lie on the same straight line.' },
  150: { title: 'Evaluate Reverse Polish Notation', difficulty: 'Medium', tags: ['Stack', 'Array'], description: 'Evaluate the value of an arithmetic expression in Reverse Polish Notation.' },
  152: { title: 'Maximum Product Subarray', difficulty: 'Medium', tags: ['DP', 'Array'], description: 'Find the contiguous subarray that has the largest product.' },
  153: { title: 'Find Minimum in Rotated Sorted Array', difficulty: 'Medium', tags: ['Binary Search'], description: 'Find the minimum element in a rotated sorted array of unique values.' },
  155: { title: 'Min Stack', difficulty: 'Medium', tags: ['Design', 'Stack'], description: 'Design a stack that supports push, pop, top, and retrieving the minimum element in O(1).' },
  160: { title: 'Intersection of Two Linked Lists', difficulty: 'Easy', tags: ['Linked List', 'Two Pointers'], description: 'Find the node at which two singly linked lists intersect, or null if they don\'t.' },
  162: { title: 'Find Peak Element', difficulty: 'Medium', tags: ['Binary Search', 'Array'], description: 'Find a peak element index in an array where neighbors are strictly smaller.' },
  167: { title: 'Two Sum II – Input Array Is Sorted', difficulty: 'Medium', tags: ['Two Pointers', 'Binary Search'], description: 'Find two numbers that sum to target in a sorted array — return 1-indexed positions.' },
  169: { title: 'Majority Element', difficulty: 'Easy', tags: ['Array', 'Hash Table'], description: 'Find the element that appears more than n/2 times (Boyer-Moore Voting Algorithm).' },
  179: { title: 'Largest Number', difficulty: 'Medium', tags: ['String', 'Sorting'], description: 'Arrange numbers to form the largest possible number.' },
  188: { title: 'Best Time to Buy and Sell Stock IV', difficulty: 'Hard', tags: ['DP', 'Array'], description: 'Maximize profit with at most k transactions.' },
  189: { title: 'Rotate Array', difficulty: 'Medium', tags: ['Array', 'Two Pointers'], description: 'Rotate an array to the right by k steps in-place.' },
  190: { title: 'Reverse Bits', difficulty: 'Easy', tags: ['Bit Manipulation'], description: 'Reverse bits of a given 32-bit unsigned integer.' },
  191: { title: 'Number of 1 Bits', difficulty: 'Easy', tags: ['Bit Manipulation'], description: 'Count the number of set bits (1s) in the binary representation of an integer (Hamming weight).' },
  198: { title: 'House Robber', difficulty: 'Medium', tags: ['DP', 'Array'], description: 'Rob houses to maximize money without robbing two adjacent houses.' },
  200: { title: 'Number of Islands', difficulty: 'Medium', tags: ['DFS', 'BFS', 'Matrix'], description: 'Count the number of islands in a 2D grid of \'1\'s (land) and \'0\'s (water).' },
  202: { title: 'Happy Number', difficulty: 'Easy', tags: ['Math', 'Hash Table', 'Two Pointers'], description: 'Determine if a number is "happy" by repeatedly replacing it with the sum of squares of its digits.' },
  206: { title: 'Reverse Linked List', difficulty: 'Easy', tags: ['Linked List'], description: 'Reverse a singly linked list iteratively or recursively.' },
  207: { title: 'Course Schedule', difficulty: 'Medium', tags: ['Graph', 'Topological Sort', 'DFS'], description: 'Determine if you can finish all courses given prerequisites (detect cycle in DAG).' },
  208: { title: 'Implement Trie (Prefix Tree)', difficulty: 'Medium', tags: ['Trie', 'Design'], description: 'Implement a Trie with insert, search, and startsWith operations.' },
  210: { title: 'Course Schedule II', difficulty: 'Medium', tags: ['Graph', 'Topological Sort'], description: 'Return the ordering of courses to finish them all, given prerequisites.' },
  211: { title: 'Design Add and Search Words Data Structure', difficulty: 'Medium', tags: ['Trie', 'DFS'], description: 'Design a data structure that supports adding words and searching with wildcard ".".' },
  212: { title: 'Word Search II', difficulty: 'Hard', tags: ['Trie', 'Backtracking', 'Matrix'], description: 'Find all words from a dictionary that exist in a 2D board using Trie + DFS.' },
  213: { title: 'House Robber II', difficulty: 'Medium', tags: ['DP'], description: 'House Robber but houses are in a circle — can\'t rob first and last both.' },
  215: { title: 'Kth Largest Element in an Array', difficulty: 'Medium', tags: ['Array', 'Heap', 'Quickselect'], description: 'Find the kth largest element in an unsorted array in O(n) using quickselect.' },
  217: { title: 'Contains Duplicate', difficulty: 'Easy', tags: ['Array', 'Hash Table'], description: 'Determine if any value appears at least twice in the array.' },
  219: { title: 'Contains Duplicate II', difficulty: 'Easy', tags: ['Array', 'Hash Table', 'Sliding Window'], description: 'Return true if any two equal elements are within k indices of each other.' },
  225: { title: 'Implement Stack using Queues', difficulty: 'Easy', tags: ['Stack', 'Queue', 'Design'], description: 'Implement a stack using only queue operations.' },
  226: { title: 'Invert Binary Tree', difficulty: 'Easy', tags: ['Tree', 'DFS', 'BFS'], description: 'Invert (mirror) a binary tree.' },
  227: { title: 'Basic Calculator II', difficulty: 'Medium', tags: ['Stack', 'Math', 'String'], description: 'Evaluate a string expression with +, -, *, / and integers (no parentheses).' },
  230: { title: 'Kth Smallest Element in a BST', difficulty: 'Medium', tags: ['Tree', 'DFS'], description: 'Find the kth smallest value in a binary search tree using inorder traversal.' },
  232: { title: 'Implement Queue using Stacks', difficulty: 'Easy', tags: ['Queue', 'Stack', 'Design'], description: 'Implement a FIFO queue using only two stacks.' },
  234: { title: 'Palindrome Linked List', difficulty: 'Easy', tags: ['Linked List', 'Two Pointers'], description: 'Check if a linked list is a palindrome in O(n) time and O(1) space.' },
  235: { title: 'Lowest Common Ancestor of a BST', difficulty: 'Medium', tags: ['Tree', 'DFS'], description: 'Find the LCA of two nodes in a binary search tree.' },
  236: { title: 'Lowest Common Ancestor of a Binary Tree', difficulty: 'Medium', tags: ['Tree', 'DFS'], description: 'Find the LCA of two nodes in a binary tree (not necessarily a BST).' },
  237: { title: 'Delete Node in a Linked List', difficulty: 'Medium', tags: ['Linked List'], description: 'Delete a node from a linked list when you only have access to that node.' },
  238: { title: 'Product of Array Except Self', difficulty: 'Medium', tags: ['Array', 'Prefix Sum'], description: 'Return an array where each element is the product of all other elements — no division, O(n).' },
  239: { title: 'Sliding Window Maximum', difficulty: 'Hard', tags: ['Sliding Window', 'Deque'], description: 'Find the maximum value in each sliding window of size k.' },
  240: { title: 'Search a 2D Matrix II', difficulty: 'Medium', tags: ['Binary Search', 'Matrix'], description: 'Search a matrix where rows and columns are sorted independently.' },
  242: { title: 'Valid Anagram', difficulty: 'Easy', tags: ['String', 'Hash Table', 'Sorting'], description: 'Determine if two strings are anagrams of each other.' },
  252: { title: 'Meeting Rooms', difficulty: 'Easy', tags: ['Array', 'Sorting', 'Intervals'], description: 'Determine if a person can attend all meetings given their intervals.' },
  253: { title: 'Meeting Rooms II', difficulty: 'Medium', tags: ['Array', 'Greedy', 'Heap'], description: 'Find the minimum number of meeting rooms required.' },
  261: { title: 'Graph Valid Tree', difficulty: 'Medium', tags: ['Graph', 'Union Find', 'DFS'], description: 'Determine if n nodes with given edges form a valid tree (connected, no cycle).' },
  268: { title: 'Missing Number', difficulty: 'Easy', tags: ['Array', 'Math', 'Bit Manipulation'], description: 'Find the one missing number in an array containing n distinct numbers from 0 to n.' },
  269: { title: 'Alien Dictionary', difficulty: 'Hard', tags: ['Graph', 'Topological Sort'], description: 'Derive the alphabetical order of an alien language from a sorted list of words.' },
  271: { title: 'Encode and Decode Strings', difficulty: 'Medium', tags: ['String', 'Design'], description: 'Design an algorithm to encode and decode a list of strings to and from a single string.' },
  278: { title: 'First Bad Version', difficulty: 'Easy', tags: ['Binary Search'], description: 'Find the first bad version using binary search and a provided isBadVersion API.' },
  279: { title: 'Perfect Squares', difficulty: 'Medium', tags: ['DP', 'BFS', 'Math'], description: 'Find the minimum number of perfect squares that sum to n.' },
  283: { title: 'Move Zeroes', difficulty: 'Easy', tags: ['Array', 'Two Pointers'], description: 'Move all 0s to the end of an array while maintaining the relative order of non-zero elements.' },
  287: { title: 'Find the Duplicate Number', difficulty: 'Medium', tags: ['Array', 'Two Pointers', 'Bit Manipulation'], description: 'Find the duplicate number in an array without modifying it and using O(1) space (Floyd\'s cycle).' },
  295: { title: 'Find Median from Data Stream', difficulty: 'Hard', tags: ['Design', 'Heap'], description: 'Find the median from a data stream in O(log n) using two heaps (max-heap + min-heap).' },
  297: { title: 'Serialize and Deserialize Binary Tree', difficulty: 'Hard', tags: ['Tree', 'BFS', 'DFS', 'Design'], description: 'Design an algorithm to serialize and deserialize a binary tree.' },
  300: { title: 'Longest Increasing Subsequence', difficulty: 'Medium', tags: ['DP', 'Binary Search'], description: 'Find the length of the longest strictly increasing subsequence in an array.' },
  301: { title: 'Remove Invalid Parentheses', difficulty: 'Hard', tags: ['Backtracking', 'BFS'], description: 'Remove the minimum number of invalid parentheses to make the input valid.' },
  303: { title: 'Range Sum Query – Immutable', difficulty: 'Easy', tags: ['Array', 'Prefix Sum'], description: 'Compute range sum queries efficiently using prefix sums.' },
  310: { title: 'Minimum Height Trees', difficulty: 'Medium', tags: ['Graph', 'BFS', 'Topological Sort'], description: 'Find all roots of trees with minimum height (similar to topological peeling).' },
  312: { title: 'Burst Balloons', difficulty: 'Hard', tags: ['DP', 'Divide & Conquer'], description: 'Burst balloons to maximize coins collected — interval DP problem.' },
  322: { title: 'Coin Change', difficulty: 'Medium', tags: ['DP', 'BFS'], description: 'Find the minimum number of coins that make up a given amount.' },
  323: { title: 'Number of Connected Components in an Undirected Graph', difficulty: 'Medium', tags: ['Graph', 'Union Find', 'DFS'], description: 'Count connected components in an undirected graph.' },
  338: { title: 'Counting Bits', difficulty: 'Easy', tags: ['DP', 'Bit Manipulation'], description: 'Return an array of the number of 1s in the binary representation of numbers 0 to n.' },
  340: { title: 'Longest Substring with At Most K Distinct Characters', difficulty: 'Medium', tags: ['Sliding Window', 'Hash Table'], description: 'Find the length of the longest substring with at most k distinct characters.' },
  347: { title: 'Top K Frequent Elements', difficulty: 'Medium', tags: ['Array', 'Hash Table', 'Heap', 'Bucket Sort'], description: 'Return the k most frequent elements in an array.' },
  348: { title: 'Design Tic-Tac-Toe', difficulty: 'Medium', tags: ['Design', 'Array'], description: 'Design a Tic-Tac-Toe game with O(1) win checking.' },
  371: { title: 'Sum of Two Integers', difficulty: 'Medium', tags: ['Bit Manipulation', 'Math'], description: 'Calculate the sum of two integers without using + or - operators (use XOR and carry).' },
  378: { title: 'Kth Smallest Element in a Sorted Matrix', difficulty: 'Medium', tags: ['Binary Search', 'Heap', 'Matrix'], description: 'Find the kth smallest element in an n×n matrix where each row and column is sorted.' },
  380: { title: 'Insert Delete GetRandom O(1)', difficulty: 'Medium', tags: ['Design', 'Array', 'Hash Table'], description: 'Design a data structure for O(1) insert, delete, and getRandom.' },
  387: { title: 'First Unique Character in a String', difficulty: 'Easy', tags: ['String', 'Hash Table'], description: 'Find the first non-repeating character in a string and return its index.' },
  394: { title: 'Decode String', difficulty: 'Medium', tags: ['Stack', 'String'], description: 'Decode a string encoded as k[encoded_string] recursively.' },
  399: { title: 'Evaluate Division', difficulty: 'Medium', tags: ['Graph', 'BFS', 'Union Find'], description: 'Given equations like a/b = k, evaluate queries of the form x/y.' },
  404: { title: 'Sum of Left Leaves', difficulty: 'Easy', tags: ['Tree', 'DFS'], description: 'Find the sum of all left leaves in a binary tree.' },
  406: { title: 'Queue Reconstruction by Height', difficulty: 'Medium', tags: ['Array', 'Greedy'], description: 'Reconstruct a queue of people by height and number of people in front.' },
  409: { title: 'Longest Palindrome', difficulty: 'Easy', tags: ['String', 'Hash Table'], description: 'Find the length of the longest palindrome that can be built from given characters.' },
  412: { title: 'Fizz Buzz', difficulty: 'Easy', tags: ['Math', 'String'], description: 'Output strings based on divisibility by 3 and 5.' },
  416: { title: 'Partition Equal Subset Sum', difficulty: 'Medium', tags: ['DP', 'Array'], description: 'Determine if an array can be partitioned into two subsets with equal sum.' },
  417: { title: 'Pacific Atlantic Water Flow', difficulty: 'Medium', tags: ['DFS', 'BFS', 'Matrix'], description: 'Find cells in a matrix where water can flow to both Pacific and Atlantic oceans.' },
  424: { title: 'Longest Repeating Character Replacement', difficulty: 'Medium', tags: ['Sliding Window', 'String'], description: 'Find the length of the longest substring after replacing at most k characters.' },
  435: { title: 'Non-overlapping Intervals', difficulty: 'Medium', tags: ['Greedy', 'Intervals'], description: 'Find the minimum number of intervals to remove to make the rest non-overlapping.' },
  437: { title: 'Path Sum III', difficulty: 'Medium', tags: ['Tree', 'DFS', 'Prefix Sum'], description: 'Count paths in a binary tree that sum to a given targetSum (any start/end node).' },
  438: { title: 'Find All Anagrams in a String', difficulty: 'Medium', tags: ['Sliding Window', 'String'], description: 'Return all start indices of p\'s anagrams in s using a sliding window.' },
  448: { title: 'Find All Numbers Disappeared in an Array', difficulty: 'Easy', tags: ['Array', 'Hash Table'], description: 'Find all numbers from 1 to n that are missing from the array.' },
  450: { title: 'Delete Node in a BST', difficulty: 'Medium', tags: ['Tree', 'BST'], description: 'Delete a node from a binary search tree and return the root.' },
  451: { title: 'Sort Characters By Frequency', difficulty: 'Medium', tags: ['String', 'Hash Table', 'Heap'], description: 'Sort a string by the frequency of its characters, highest first.' },
  461: { title: 'Hamming Distance', difficulty: 'Easy', tags: ['Bit Manipulation'], description: 'Find the number of positions where two integers differ in their binary representations.' },
  494: { title: 'Target Sum', difficulty: 'Medium', tags: ['DP', 'Backtracking'], description: 'Count the number of ways to assign + or - to integers to achieve a target sum.' },
  496: { title: 'Next Greater Element I', difficulty: 'Easy', tags: ['Stack', 'Array', 'Monotonic Stack'], description: 'Find the next greater element for each number of nums1 in nums2.' },
  503: { title: 'Next Greater Element II', difficulty: 'Medium', tags: ['Stack', 'Monotonic Stack'], description: 'Find the next greater element in a circular array.' },
  509: { title: 'Fibonacci Number', difficulty: 'Easy', tags: ['DP', 'Math', 'Recursion'], description: 'Calculate the nth Fibonacci number.' },
  518: { title: 'Coin Change II', difficulty: 'Medium', tags: ['DP', 'Array'], description: 'Count the number of combinations of coins that make up the given amount.' },
  543: { title: 'Diameter of Binary Tree', difficulty: 'Easy', tags: ['Tree', 'DFS'], description: 'Find the diameter (longest path between any two nodes) of a binary tree.' },
  560: { title: 'Subarray Sum Equals K', difficulty: 'Medium', tags: ['Array', 'Hash Table', 'Prefix Sum'], description: 'Count the total number of subarrays whose sum equals k.' },
  567: { title: 'Permutation in String', difficulty: 'Medium', tags: ['Sliding Window', 'String'], description: 'Check if s2 contains a permutation of s1 as a substring.' },
  572: { title: 'Subtree of Another Tree', difficulty: 'Easy', tags: ['Tree', 'DFS', 'String Matching'], description: 'Check if one binary tree is a subtree of another.' },
  606: { title: 'Construct String from Binary Tree', difficulty: 'Easy', tags: ['Tree', 'DFS', 'String'], description: 'Construct a string from a binary tree\'s preorder traversal with parentheses.' },
  621: { title: 'Task Scheduler', difficulty: 'Medium', tags: ['Greedy', 'Heap', 'Array'], description: 'Find the minimum number of CPU intervals to finish all tasks with n cool-down.' },
  647: { title: 'Palindromic Substrings', difficulty: 'Medium', tags: ['String', 'DP', 'Expand Around Center'], description: 'Count the number of palindromic substrings in a string.' },
  678: { title: 'Valid Parenthesis String', difficulty: 'Medium', tags: ['Greedy', 'String', 'DP'], description: 'Check if a string with \'(\', \')\', and \'*\' characters is a valid parenthesis string.' },
  684: { title: 'Redundant Connection', difficulty: 'Medium', tags: ['Graph', 'Union Find'], description: 'Find the edge that can be removed to make a graph with n nodes a tree.' },
  695: { title: 'Max Area of Island', difficulty: 'Medium', tags: ['DFS', 'BFS', 'Matrix'], description: 'Find the maximum area of an island in a 2D grid of 0s and 1s.' },
  703: { title: 'Kth Largest Element in a Stream', difficulty: 'Easy', tags: ['Design', 'Heap'], description: 'Find the kth largest element in a stream of integers using a min-heap.' },
  704: { title: 'Binary Search', difficulty: 'Easy', tags: ['Binary Search', 'Array'], description: 'Implement binary search on a sorted array to find a target value.' },
  706: { title: 'Design HashMap', difficulty: 'Easy', tags: ['Design', 'Hash Table'], description: 'Design a HashMap without built-in hash table libraries.' },
  724: { title: 'Find Pivot Index', difficulty: 'Easy', tags: ['Array', 'Prefix Sum'], description: 'Find the pivot index where the sum of elements to the left equals the sum to the right.' },
  739: { title: 'Daily Temperatures', difficulty: 'Medium', tags: ['Stack', 'Monotonic Stack', 'Array'], description: 'Return how many days until a warmer temperature for each day (monotonic stack).' },
  743: { title: 'Network Delay Time', difficulty: 'Medium', tags: ['Graph', 'Dijkstra', 'Shortest Path'], description: 'Find the time it takes for all nodes to receive a signal using Dijkstra\'s algorithm.' },
  746: { title: 'Min Cost Climbing Stairs', difficulty: 'Easy', tags: ['DP', 'Array'], description: 'Find the minimum cost to reach the top of the floor, starting at step 0 or 1.' },
  763: { title: 'Partition Labels', difficulty: 'Medium', tags: ['Greedy', 'String', 'Two Pointers'], description: 'Partition a string into as many parts as possible so that each character appears in at most one part.' },
  778: { title: 'Swim in Rising Water', difficulty: 'Hard', tags: ['Binary Search', 'Heap', 'Graph'], description: 'Find the minimum time to reach bottom-right in a 2D grid where elevation rises over time.' },
  784: { title: 'Letter Case Permutation', difficulty: 'Medium', tags: ['Backtracking', 'String'], description: 'Generate all strings by toggling the case of each letter in a string.' },
  787: { title: 'Cheapest Flights Within K Stops', difficulty: 'Medium', tags: ['Graph', 'DP', 'BFS', 'Bellman-Ford'], description: 'Find the cheapest price from src to dst with at most k stops.' },
  844: { title: 'Backspace String Compare', difficulty: 'Easy', tags: ['String', 'Stack', 'Two Pointers'], description: 'Compare two strings with "#" as backspace characters.' },
  846: { title: 'Hand of Straights', difficulty: 'Medium', tags: ['Greedy', 'Hash Table'], description: 'Check if a hand of cards can be rearranged into groups of consecutive cards of size groupSize.' },
  853: { title: 'Car Fleet', difficulty: 'Medium', tags: ['Array', 'Sorting', 'Stack'], description: 'Count how many car fleets reach the same destination within one trip.' },
  875: { title: 'Koko Eating Bananas', difficulty: 'Medium', tags: ['Binary Search', 'Array'], description: 'Find the minimum eating speed for Koko to finish all bananas within h hours.' },
  876: { title: 'Middle of the Linked List', difficulty: 'Easy', tags: ['Linked List', 'Two Pointers'], description: 'Find the middle node of a linked list using slow/fast pointers.' },
  895: { title: 'Maximum Frequency Stack', difficulty: 'Hard', tags: ['Design', 'Stack', 'Hash Table'], description: 'Design a stack that pops the most frequently pushed element.' },
  904: { title: 'Fruit Into Baskets', difficulty: 'Medium', tags: ['Sliding Window', 'Hash Table'], description: 'Find the maximum length subarray with at most 2 distinct values.' },
  912: { title: 'Sort an Array', difficulty: 'Medium', tags: ['Sorting', 'Array'], description: 'Sort an array using an algorithm (merge sort, heap sort, quick sort) without Array.sort().' },
  918: { title: 'Maximum Sum Circular Subarray', difficulty: 'Medium', tags: ['DP', 'Array'], description: 'Find the maximum sum of a circular subarray.' },
  973: { title: 'K Closest Points to Origin', difficulty: 'Medium', tags: ['Array', 'Heap', 'Quickselect'], description: 'Return the k closest points to the origin in a 2D plane.' },
  981: { title: 'Time Based Key-Value Store', difficulty: 'Medium', tags: ['Design', 'Binary Search', 'Hash Table'], description: 'Design a key-value store that supports setting and getting values at specific timestamps.' },
  994: { title: 'Rotting Oranges', difficulty: 'Medium', tags: ['BFS', 'Matrix'], description: 'Find the minimum time for all fresh oranges to rot, given rotten oranges spread per minute.' },
  1004: { title: 'Max Consecutive Ones III', difficulty: 'Medium', tags: ['Sliding Window', 'Array'], description: 'Find the maximum number of consecutive 1s if you can flip at most k zeros.' },
  1046: { title: 'Last Stone Weight', difficulty: 'Easy', tags: ['Heap', 'Array'], description: 'Smash the two heaviest stones together repeatedly. Return the remaining stone weight or 0.' },
  1047: { title: 'Remove All Adjacent Duplicates in String', difficulty: 'Easy', tags: ['Stack', 'String'], description: 'Remove adjacent duplicate characters in a string until no more can be removed.' },
  1143: { title: 'Longest Common Subsequence', difficulty: 'Medium', tags: ['DP', 'String'], description: 'Find the length of the longest common subsequence between two strings.' },
  1161: { title: 'Maximum Level Sum of a Binary Tree', difficulty: 'Medium', tags: ['Tree', 'BFS'], description: 'Find the level with the maximum sum in a binary tree.' },
  1209: { title: 'Remove All Adjacent Duplicates in String II', difficulty: 'Medium', tags: ['Stack', 'String'], description: 'Remove k adjacent identical characters repeatedly until no more removals are possible.' },
  1235: { title: 'Maximum Profit in Job Scheduling', difficulty: 'Hard', tags: ['DP', 'Binary Search', 'Intervals'], description: 'Schedule non-overlapping jobs to maximize total profit using DP + binary search.' },
  1248: { title: 'Count Number of Nice Subarrays', difficulty: 'Medium', tags: ['Sliding Window', 'Array', 'Prefix Sum'], description: 'Count subarrays that contain exactly k odd numbers.' },
  1268: { title: 'Search Suggestions System', difficulty: 'Medium', tags: ['Trie', 'Binary Search', 'String'], description: 'Return top 3 lexicographic suggestions from a product list for each prefix typed.' },
  1293: { title: 'Shortest Path in a Grid with Obstacles Elimination', difficulty: 'Hard', tags: ['BFS', 'DP', 'Matrix'], description: 'Find the shortest path from top-left to bottom-right, able to eliminate at most k obstacles.' },
  1337: { title: 'The K Weakest Rows in a Matrix', difficulty: 'Easy', tags: ['Binary Search', 'Heap', 'Matrix'], description: 'Find the k weakest rows (fewest 1s) in a binary matrix.' },
  1343: { title: 'Number of Sub-arrays of Size K and Average Greater than or Equal to Threshold', difficulty: 'Medium', tags: ['Sliding Window', 'Array'], description: 'Count subarrays of size k whose average is >= threshold.' },
  1448: { title: 'Count Good Nodes in Binary Tree', difficulty: 'Medium', tags: ['Tree', 'DFS'], description: 'Count nodes where no node on the path from root to that node has a greater value.' },
  1472: { title: 'Design Browser History', difficulty: 'Medium', tags: ['Design', 'Stack', 'Array'], description: 'Design a browser history structure with visit, back, and forward operations.' },
  1480: { title: 'Running Sum of 1D Array', difficulty: 'Easy', tags: ['Array', 'Prefix Sum'], description: 'Return the running sum of an array (each element is sum of all previous elements + itself).' },
  1584: { title: 'Min Cost to Connect All Points', difficulty: 'Medium', tags: ['Graph', 'Minimum Spanning Tree', 'Prim', 'Kruskal'], description: 'Find the minimum cost to connect all points using Manhattan distance (MST problem).' },
  1647: { title: 'Minimum Deletions to Make Character Frequencies Unique', difficulty: 'Medium', tags: ['Greedy', 'String'], description: 'Find the minimum deletions so that no two characters have the same frequency.' },
  1657: { title: 'Determine if Two Strings Are Close', difficulty: 'Medium', tags: ['String', 'Hash Table'], description: 'Two strings are close if you can make them equal by swapping or transforming characters.' },
  1695: { title: 'Maximum Erasure Value', difficulty: 'Medium', tags: ['Sliding Window', 'Array', 'Hash Table'], description: 'Find the maximum sum of a subarray with all unique elements.' },
  1700: { title: 'Number of Students Unable to Eat Lunch', difficulty: 'Easy', tags: ['Array', 'Stack', 'Queue'], description: 'Count students unable to eat if they only eat their preferred sandwich type.' },
  1768: { title: 'Merge Strings Alternately', difficulty: 'Easy', tags: ['String', 'Two Pointers'], description: 'Merge two strings by alternating their characters.' },
  1971: { title: 'Find if Path Exists in Graph', difficulty: 'Easy', tags: ['Graph', 'Union Find', 'DFS', 'BFS'], description: 'Return true if there is a valid path from source to destination in an undirected graph.' },
  2095: { title: 'Delete the Middle Node of a Linked List', difficulty: 'Medium', tags: ['Linked List', 'Two Pointers'], description: 'Delete the middle node of a linked list using slow/fast pointers.' },
  2130: { title: 'Maximum Twin Sum of a Linked List', difficulty: 'Medium', tags: ['Linked List', 'Two Pointers', 'Stack'], description: 'Find the maximum twin sum (node + its mirror) of a linked list.' },
  2215: { title: 'Find the Difference of Two Arrays', difficulty: 'Easy', tags: ['Array', 'Hash Table'], description: 'Return two lists of unique elements in each array not present in the other.' },
  2390: { title: 'Removing Stars From a String', difficulty: 'Medium', tags: ['Stack', 'String'], description: 'Remove stars and their nearest non-star character to the left.' },
  2462: { title: 'Total Cost to Hire K Workers', difficulty: 'Medium', tags: ['Heap', 'Array', 'Two Pointers'], description: 'Hire k workers with minimum cost, choosing from the cheapest in the first or last candidates.' },
};

/**
 * Parse the admin's customPrompt and expand any LeetCode problem references
 * (e.g. "LeetCode 29", "leetcode #215", "LC 146") into full problem context.
 *
 * Returns the enriched prompt string with problem context injected after each mention.
 */
export const expandLeetCodeReferences = (prompt) => {
  if (!prompt) return prompt;

  // Match patterns: "leetcode 29", "leetcode #29", "lc 29", "LC-29", "problem 29" (when near "leetcode")
  const LEETCODE_PATTERN = /(?:leet\s*code|lc)\s*#?\s*(\d+)/gi;

  const foundNumbers = new Set();
  let match;
  while ((match = LEETCODE_PATTERN.exec(prompt)) !== null) {
    foundNumbers.add(parseInt(match[1], 10));
  }

  if (foundNumbers.size === 0) return prompt;

  // Build injection block for each found problem
  const problemContextBlocks = [];
  for (const num of foundNumbers) {
    const problem = LEETCODE_PROBLEMS[num];
    if (problem) {
      problemContextBlocks.push(
        `LeetCode #${num} — "${problem.title}" [${problem.difficulty}]\n` +
        `  Tags: ${problem.tags.join(', ')}\n` +
        `  Description: ${problem.description}`
      );
    } else {
      // Unknown number — tell AI to use its own knowledge
      problemContextBlocks.push(
        `LeetCode #${num} — [Unknown in local database. Use your training knowledge of this problem.]`
      );
    }
  }

  return (
    prompt +
    `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `LEETCODE PROBLEM REFERENCE (auto-resolved):\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    problemContextBlocks.join('\n\n') +
    `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `Use the above problem details to ask questions about the actual problem — ` +
    `its logic, edge cases, time/space complexity, and implementation approach.`
  );
};

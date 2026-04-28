import { interviewGraph } from '../src/langgraph/graph.js';

const getRollingHistory = (answerHistory, limit = 3) => {
  return answerHistory
    .filter(a => a.type === 'technical')
    .slice(-limit)
    .map(a => `Q: ${a.question}\nA: ${a.answer}`)
    .join('\n\n');
};

const history = [
    { type: 'technical', question: 'Q1', answer: 'A1' },
    { type: 'background', question: 'Q2', answer: 'A2' },
    { type: 'technical', question: 'Q3', answer: 'A3' },
    { type: 'technical', question: 'Q4', answer: 'A4' },
    { type: 'technical', question: 'Q5', answer: 'A5' },
];

console.log('--- Rolling History (Limit 3) ---');
console.log(getRollingHistory(history, 3));
console.log('--- End ---');
process.exit(0);

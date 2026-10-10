import { checkPoint } from '../src/core/verify.ts';

const allowed = new Map([
  ['p1.0', 'You must register for GST if your turnover was $60,000 or more in the last 12 months.'],
  ['p1.1', 'You can choose to register even if your turnover is under $60,000.'],
  ['p2.0', 'GST returns and payments are usually due on the 28th of the month after the end of your taxable period.'],
]);

describe('checkPoint', () => {
  it('accepts a paraphrase whose figures and wording match the cited sentence', () => {
    const r = checkPoint({ text: 'You must register once your turnover reaches $60,000 in the last 12 months.', citations: ['p1.0'] }, allowed);
    expect(r.status).toBe('verified');
    expect(r.reasons).toEqual([]);
  });

  it('rejects a point with a figure that is not in the cited text', () => {
    const r = checkPoint({ text: 'You must register once your turnover reaches $80,000 in the last 12 months.', citations: ['p1.0'] }, allowed);
    expect(r.status).toBe('rejected');
    expect(r.reasons.join()).toMatch(/80000/);
  });

  it('rejects invented citation ids', () => {
    const r = checkPoint({ text: 'You must register if turnover is $60,000.', citations: ['p9.9'] }, allowed);
    expect(r.status).toBe('rejected');
    expect(r.reasons.join()).toMatch(/not in the sources/);
  });

  it('rejects a point that cites a real sentence about something else', () => {
    const r = checkPoint({ text: 'Payments are due on the 28th of the month after the period ends.', citations: ['p1.1'] }, allowed);
    expect(r.status).toBe('rejected');
  });

  it('rejects a point with no citation', () => {
    expect(checkPoint({ text: 'GST is 15%.', citations: [] }, allowed).status).toBe('rejected');
  });
});

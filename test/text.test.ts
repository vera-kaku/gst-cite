import { splitSentences, extractNumbers, deepLink, contentWords } from '../src/core/text.ts';

describe('splitSentences', () => {
  it('splits on sentence ends but not inside abbreviations or amounts', () => {
    const s = splitSentences('You may claim costs, e.g. rent and power. The limit is $1.5 million. Is it 15%? Yes.');
    expect(s).toEqual(['You may claim costs, e.g. rent and power.', 'The limit is $1.5 million.', 'Is it 15%?', 'Yes.']);
  });

  it('keeps list-like text without punctuation as one sentence', () => {
    expect(splitSentences('your IRD number')).toEqual(['your IRD number']);
  });
});

describe('extractNumbers', () => {
  it('normalises amounts and percentages', () => {
    expect(extractNumbers('Register if turnover is $60,000 or more; the rate is 15% and returns are due on 28 May 2026.')).toEqual(['60000', '15', '28', '2026']);
  });
});

describe('contentWords', () => {
  it('drops stopwords and stems simple endings', () => {
    expect(contentWords('You must register for GST')).toEqual(contentWords('register GST'));
    expect(contentWords('You must register for GST')).toHaveLength(2);
    expect(contentWords('registering')).toEqual(contentWords('registered'));
  });
});

describe('deepLink', () => {
  it('builds a text fragment link with start and end words for long sentences', () => {
    const link = deepLink('https://example.org/gst', 'You must register for GST if your turnover was $60,000 or more in the last 12 months.');
    expect(link).toBe('https://example.org/gst#:~:text=You%20must%20register%20for%20GST,the%20last%2012%20months.');
  });

  it('encodes hyphens and commas, which have meaning in text fragments', () => {
    expect(deepLink('https://x.org', 'Six-monthly filing, explained')).toBe('https://x.org#:~:text=Six%2Dmonthly%20filing%2C%20explained');
  });
});

describe('term matching', () => {
  it('treats register and registration, cancel and cancelling as the same term', async () => {
    const { sameTerm } = await import('../src/core/text.ts');
    const [reg] = contentWords('register');
    const [regn] = contentWords('registration');
    expect(sameTerm(reg!, regn!)).toBe(true);
    expect(contentWords('cancelling')).toEqual(contentWords('cancel'));
  });

  it('matches "six months" with "6-monthly" but keeps zero-rated apart from rate', () => {
    const [q] = contentWords('six months');
    const [t] = contentWords('6-monthly');
    expect(t!.startsWith(q!)).toBe(true);
    expect(contentWords('zero-rated')).not.toContain(contentWords('rate')[0]);
    expect(contentWords('one group')).not.toContain('1group');
  });
});

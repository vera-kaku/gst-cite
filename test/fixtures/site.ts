/**
 * SYNTHETIC TEST FIXTURES. These pages are written for the tests and only imitate the
 * layout of a government guidance site (header, navigation, main content, footer).
 * The wording is not copied from Inland Revenue and must not be treated as tax guidance.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const layout = (title: string, body: string) => `<!doctype html>
<html><head><title>${title} | Test Revenue Site</title></head>
<body>
<header><a href="/">Home</a><nav><a href="/income-tax">Income tax</a> <a href="/gst">GST</a> <a href="/kiwisaver">KiwiSaver</a></nav></header>
<main>
<h1>${title}</h1>
${body}
</main>
<footer><p>Copyright notice for the test site. Contact us on 0800 000 000.</p><a href="/about">About</a></footer>
</body></html>`;

const index = (extraLink = '') =>
  layout(
    'GST (Goods and services tax)',
    `<p>GST is a tax added to the price of most goods and services sold in New Zealand. The standard rate of GST is 15%.</p>
<p>Businesses that are registered collect GST on their sales and claim back the GST they pay on business purchases.</p>
<ul>
<li><a href="/gst/registering-for-gst">Registering for GST</a></li>
<li><a href="/gst/filing-frequency?ref=menu#top">Filing frequency and due dates</a></li>
<li><a href="/gst/taxable-supply-information">Taxable supply information</a></li>
${extraLink}
<li><a href="/gst/guide.pdf">Printable guide (PDF)</a></li>
<li><a href="/gst/private">Internal page</a></li>
<li><a href="https://example.com/gst">External site</a></li>
</ul>`,
  );

const registering = layout(
  'Registering for GST',
  `<h2>Who must register</h2>
<p>You must register for GST if your turnover was $60,000 or more in the last 12 months. You must also register if you expect your turnover to be $60,000 or more in the next 12 months.</p>
<h2>Registering voluntarily</h2>
<p>You can choose to register even if your turnover is under $60,000. Once registered, you must charge GST on your sales and file GST returns.</p>
<h3>What you need to register</h3>
<p>Have these details ready:</p>
<ul><li>your IRD number</li><li>your bank account number</li><li>the date you want your registration to start</li></ul>`,
);

const filing = (v2: boolean) =>
  layout(
    'Filing frequency and due dates',
    `<h2>Choosing how often you file</h2>
<p>You can file GST returns monthly, every 2 months or every 6 months. The 6-monthly option is only available if your turnover is under $500,000 in a 12-month period.</p>
<p>${v2 ? 'Two-monthly filing is the default if you do not choose an option.' : 'Most businesses file every 2 months.'}</p>
<h2>Payment due dates</h2>
<p>GST returns and payments are usually due on the 28th of the month after the end of your taxable period. There are two exceptions. Returns for the period ending 31 March are due on 7 May, and returns for the period ending 30 November are due on 15 January.</p>
<table><tr><th>Period ends</th><th>Due date</th></tr><tr><td>31 March</td><td>7 May</td></tr><tr><td>30 November</td><td>15 January</td></tr></table>`,
  );

const supplyInfo = layout(
  'Taxable supply information',
  `<p>If a supply is $200 or less, you do not need to provide taxable supply information.</p>
<p>For supplies over $200 and up to $1,000, the information must include the supplier's name and GST number, the date, a description of the goods or services and the amount charged.</p>
<p>For supplies over $1,000, the recipient's name and address must also be shown, e.g. on the invoice.</p>`,
);

const online = layout(
  'GST on remote services',
  `<p>Offshore suppliers of remote services must register for GST if their supplies to New Zealand consumers exceed $60,000 in a 12-month period.</p>
<p>Remote services include streaming, software and online advice supplied from outside New Zealand.</p>`,
);

export function siteRoutes(version: 1 | 2): Record<string, string> {
  return {
    '/gst': version === 2 ? index('<li><a href="/gst/remote-services">GST on remote services</a></li>') : index(),
    '/gst/registering-for-gst': registering,
    '/gst/filing-frequency': filing(version === 2),
    '/gst/taxable-supply-information': supplyInfo,
    ...(version === 2 ? { '/gst/remote-services': online } : {}),
    '/gst/private': layout('Private', '<p>This page is blocked by robots.txt and must never be fetched.</p>'),
    '/income-tax': layout('Income tax', '<p>Out of scope for the GST crawler.</p>'),
  };
}

export async function serveSite(initial: 1 | 2 = 1) {
  let routes = siteRoutes(initial);
  const requested: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    requested.push(url.pathname);
    if (url.pathname === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('User-agent: *\nDisallow: /gst/private\n');
    }
    const html = routes[url.pathname];
    if (!html) {
      res.writeHead(404, { 'content-type': 'text/html' });
      return res.end('<h1>Not found</h1>');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    requested,
    setVersion: (v: 1 | 2) => {
      routes = siteRoutes(v);
    },
    config: { name: 'Test site', startUrls: [`${base}/gst`], allowPrefixes: [`${base}/gst`], maxPages: 20, delayMs: 0, userAgent: 'GSTCiteTest' },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

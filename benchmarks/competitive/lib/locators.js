'use strict';
// One neutral primary locator per fixture, identical for every tool. The workload is "a hook the test
// relied on changed", so the locator targets the first hook (data-testid, id, name, aria-label) whose
// value differs between pre.html and post.html. When the mutation changes no hook (structure, wrapper,
// siblings, duplicates), it falls back to best-practice order on pre.html, then a structural CSS path.
const HOOKS = [['data-testid', 'data-testid'], ['id', 'id'], ['name', 'name'], ['aria-label', 'aria-label']];

async function read(page, url, gt) {
  await page.goto(url, { waitUntil: 'load' });
  return page.evaluate(({ gt: id, hooks }) => {
    const el = document.querySelector(`[data-benchmark-ground-truth-id="${id}"]`);
    if (!el) return null;
    const attrs = Object.fromEntries(hooks.map(([a]) => [a, el.getAttribute(a)]));
    const parts = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [n];
      parts.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${same.indexOf(n) + 1})`);
    }
    return { tag: el.tagName.toLowerCase(), attrs, path: `html > ${parts.join(' > ')}` };
  }, { gt, hooks: HOOKS });
}

const css = (tag, attr, value) => (attr === 'data-testid' || attr === 'id' ? `[${attr}=${JSON.stringify(value)}]` : `${tag}[${attr}=${JSON.stringify(value)}]`);

/** Pure choice of the neutral locator from the ground-truth element's facts before and after the mutation. */
function choose(id, pre, post) {
  if (!pre) throw new Error(`fixture ${id}: pre.html has no ground-truth element`);
  const changed = HOOKS.find(([a]) => pre.attrs[a] && (!post || post.attrs[a] !== pre.attrs[a]));
  const stable = changed || HOOKS.find(([a]) => pre.attrs[a]);
  if (stable) return { selector: css(pre.tag, stable[0], pre.attrs[stable[0]]), basis: `${stable[0]}${changed ? ' (changed by the mutation)' : ''}` };
  return { selector: pre.path, basis: 'css-path' };
}

async function derive(page, fixtures, baseUrl) {
  const out = new Map();
  for (const f of fixtures) {
    const pre = await read(page, `${baseUrl}/f/${f.id}/pre.html`, f.groundTruthId);
    const post = await read(page, `${baseUrl}/f/${f.id}/post.html`, f.groundTruthId);
    out.set(f.id, choose(f.id, pre, post));
  }
  return out;
}

module.exports = { derive, choose };

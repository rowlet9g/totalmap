// Small DOM fixture supporting only the selectors used by the serialized field probe.
// It matches descendants and direct children independently of the extraction code.
export function dom({ tag = 'div', cls = '', text = '', attrs = {}, hidden = false, children = [] } = {}) {
  const node = { tagName: tag.toUpperCase(), cls, attrs, hidden, children,
    get textContent() { return text + children.map(c => c.textContent).join(''); },
    getClientRects() { for (let p = node; p; p = p.parentElement) if (p.hidden) return []; return [{}]; },
    querySelectorAll(selector) {
      const tokens = selector.replace(/\s*>\s*/g, ' > ').trim().split(/\s+/);
      const matches = (el, token) => {
        const role = token.match(/\[role="([^"]+)"\]/)?.[1];
        if (role && el.attrs.role !== role) return false;
        const bare = token.replace(/\[role="[^"]+"\]/, '');
        const tagMatch = bare.match(/^[a-z][a-z0-9]*/i)?.[0];
        if (tagMatch && el.tagName !== tagMatch.toUpperCase()) return false;
        return [...bare.matchAll(/\.([a-z0-9_-]+)/gi)].every(m => el.cls.split(/\s+/).includes(m[1]));
      };
      const chain = (el, index) => {
        if (!el || !matches(el, tokens[index])) return false;
        if (index === 0) return true;
        if (tokens[index - 1] === '>') return chain(el.parentElement, index - 2);
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (chain(p, index - 1)) return true;
          if (p === node) break;
        }
        return false;
      };
      const found = [];
      const visit = el => { for (const child of el.children) { if (chain(child, tokens.length - 1)) found.push(child); visit(child); } };
      visit(node); return found;
    },
  };
  for (const child of children) child.parentElement = node;
  return node;
}

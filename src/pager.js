const { randomBytes } = require('crypto');

const PREFIX = 'page';
const MAX_ENTRIES = 200;
const MAX_PAGES = 100;
const SECONDARY = 2;
const BUTTON = 2;
const ACTION_ROW = 1;

const isPage = page => page !== null && typeof page === 'object' && !Array.isArray(page);

function createPager({
  ttl = 15 * 60 * 1000,
  now = Date.now,
  makeKey = () => randomBytes(6).toString('hex'),
} = {}) {
  const entries = new Map();

  const sweep = () => {
    const time = now();
    Array.from(entries.entries())
      .filter(([, entry]) => time - entry.created > ttl)
      .forEach(([key]) => entries.delete(key));
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
  };

  function view(entry, key, wanted) {
    const total = entry.pages.length;
    const index = Math.min(Math.max(Number(wanted) || 0, 0), total - 1);
    const page = entry.pages[index];
    const note = `Page ${index + 1} of ${total} · a snapshot, it does not update`;
    const button = (label, to, disabled) => ({
      type: BUTTON,
      style: SECONDARY,
      label,
      custom_id: `${PREFIX}:${key}:${to}`,
      disabled,
    });
    return {
      embeds: [{
        ...page,
        footer: { text: page.footer && page.footer.text ? `${page.footer.text} · ${note}` : note },
        timestamp: new Date(entry.created).toISOString(),
      }],
      components: [{
        type: ACTION_ROW,
        components: [
          button('Previous', index - 1, index === 0),
          button(`${index + 1} / ${total}`, index, true),
          button('Next', index + 1, index === total - 1),
        ],
      }],
    };
  }

  return {
    add(pages) {
      sweep();
      const key = makeKey();
      const list = pages.filter(isPage).slice(0, MAX_PAGES);
      if (!list.length) return null;
      entries.set(key, { pages: list, created: now() });
      return { key, ...view(entries.get(key), key, 0) };
    },

    open(key, index) {
      sweep();
      const entry = entries.get(key);
      if (!entry) return null;
      return view(entry, key, index);
    },

    parse(customId) {
      const [prefix, key, index] = String(customId || '').split(':');
      if (prefix !== PREFIX || !key || !/^\d+$/.test(index || '')) return null;
      return { key, index: Number(index) };
    },
  };
}

function attachPages(pager, content, pages) {
  const list = Array.isArray(pages) ? pages.filter(isPage) : [];
  if (!list.length) return content;
  if (list.length === 1) return { ...content, content: undefined, embeds: [list[0]] };
  const added = pager.add(list);
  return {
    ...content, content: undefined, embeds: added.embeds, components: added.components,
  };
}

module.exports = { attachPages, createPager };

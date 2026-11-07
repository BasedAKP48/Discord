const utils = require('@basedakp48/plugin-utils');

const ACTION_ROW = 1;
const BUTTON = 2;
const LINK = 5;
const MAX_ROWS = 5;
const STYLES = {
  primary: 1,
  secondary: 2,
  success: 3,
  danger: 4,
};

function toDiscordComponents(cid, input) {
  return utils.buildComponents(input).map(row => ({
    type: ACTION_ROW,
    components: row.map((button) => {
      const base = { type: BUTTON, label: button.label, disabled: button.disabled === true };
      if (button.url !== undefined) return { ...base, style: LINK, url: button.url };
      return {
        ...base,
        style: STYLES[button.style || 'secondary'],
        custom_id: utils.componentCustomId(cid, button.id),
      };
    }),
  }));
}

function withComponents(content, cid, input, onError = () => {}) {
  if (input === undefined || input === null) return content;
  try {
    const rows = toDiscordComponents(cid, input);
    return { ...content, components: [...(content.components || []), ...rows].slice(0, MAX_ROWS) };
  } catch (error) {
    onError(error);
    return content;
  }
}

module.exports = { toDiscordComponents, withComponents };

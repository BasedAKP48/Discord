const { commandText } = require('./slash');

const EPHEMERAL = 64;
const APPLICATION_COMMAND = 2;
const CHAT_INPUT = 1;
const NO_RESPONSE = 'That command did not get a response.';

function createRelay({
  timeout = 30000,
  keep = 300000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onError = () => {},
} = {}) {
  const pending = new Map();

  const run = (state, task) => {
    state.queue = state.queue.then(task).catch(onError);
    return state.queue;
  };

  function forget(id) {
    const state = pending.get(id);
    if (!state) return;
    clearTimer(state.timer);
    pending.delete(id);
  }

  function expire(id) {
    const state = pending.get(id);
    if (!state || state.replied) return;
    pending.delete(id);
    run(state, () => state.interaction.editOriginalMessage({ content: NO_RESPONSE }));
  }

  return {
    has: id => pending.has(id),

    track(interaction, { ephemeral = false } = {}) {
      const state = {
        interaction,
        ephemeral,
        replied: false,
        queue: Promise.resolve(),
        timer: undefined,
      };
      state.timer = setTimer(() => expire(interaction.id), timeout);
      pending.set(interaction.id, state);
    },

    async reply(id, content, { private: hidden = false } = {}) {
      const state = pending.get(id);
      if (!state) return false;

      const first = !state.replied;
      if (first) {
        state.replied = true;
        clearTimer(state.timer);
        state.timer = setTimer(() => forget(id), keep);
      }

      const { interaction } = state;
      await run(state, async () => {
        if (!first) {
          await interaction.createFollowup(hidden ? { ...content, flags: EPHEMERAL } : content);
        } else if (hidden && !state.ephemeral) {
          await interaction.deleteOriginalMessage();
          await interaction.createFollowup({ ...content, flags: EPHEMERAL });
        } else {
          await interaction.editOriginalMessage(content);
        }
      });
      return true;
    },
  };
}

function buildInteractionMessage(interaction, text, { cid, connectorName, botName }) {
  const author = interaction.member ? interaction.member.user : interaction.user;
  const { channel } = interaction;
  const guild = channel.guild || null;

  return {
    text,
    cid,
    uid: author.id,
    channel: channel.id,
    type: 'text',
    timeReceived: Date.now(),
    data: {
      channel: `#${(guild && channel.name) || 'DirectMessage'}`,
      source: `${author.username}#${author.discriminator}`,
      sourceIsBot: author.bot,
      nick: (interaction.member && interaction.member.nick) || author.username,
      serverID: interaction.guildID || null,
      parentID: channel.parentID || null,
      server: (guild && guild.name) || 'DirectMessage',
      connectorType: 'discord',
      connectorName: connectorName || null,
      connectorBotName: botName,
      isPM: !interaction.guildID || null,
      interactionId: interaction.id,
    },
  };
}

function createInteractionHandler({
  relay,
  getCommands,
  send,
  buildMessage,
  prefix = '.',
}) {
  return async function handle(interaction) {
    if (interaction.type !== APPLICATION_COMMAND) return;
    if (!interaction.data || interaction.data.type !== CHAT_INPUT) return;

    const command = getCommands().get(interaction.data.name);
    if (!command) {
      await interaction.createMessage({ content: 'That command does not exist any more.', flags: EPHEMERAL });
      return;
    }
    if (!command.online) {
      await interaction.createMessage({ content: 'That command is not available right now.', flags: EPHEMERAL });
      return;
    }

    const ephemeral = command.private === true;
    await interaction.defer(ephemeral ? EPHEMERAL : 0);
    relay.track(interaction, { ephemeral });
    await send(buildMessage(interaction, commandText(prefix, command, interaction.data.options)));
  };
}

module.exports = {
  EPHEMERAL,
  NO_RESPONSE,
  buildInteractionMessage,
  createInteractionHandler,
  createRelay,
};

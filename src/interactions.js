const utils = require('@basedakp48/plugin-utils');

const {
  commandArgs, commandText, findChatCommand, findMenuCommand, suggestions,
} = require('./slash');

const EPHEMERAL = 64;
const APPLICATION_COMMAND = 2;
const AUTOCOMPLETE = 4;
const CHAT_INPUT = 1;
const USER_MENU = 2;
const MESSAGE_MENU = 3;
const NO_TEXT = 'That message has no text to use.';
const NO_RESPONSE = 'That command did not get a response.';
const NO_BUTTON_RESPONSE = 'That button did not get a response.';
const MESSAGE_COMPONENT = 3;
const EXPIRED = 'That list has expired. Run the command again for a fresh one.';

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
    run(state, () => (state.component
      ? state.interaction.createFollowup({ content: NO_BUTTON_RESPONSE, flags: EPHEMERAL })
      : state.interaction.editOriginalMessage({ content: NO_RESPONSE })));
  }

  return {
    has: id => pending.has(id),

    track(interaction, { ephemeral = false, component = false } = {}) {
      const state = {
        interaction,
        ephemeral,
        component,
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
        } else if (state.component) {
          await (hidden
            ? interaction.createFollowup({ ...content, flags: EPHEMERAL })
            : interaction.editOriginalMessage(content.components === undefined
              ? { ...content, components: [] }
              : content));
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

function describeInteraction(interaction, { connectorName, botName }) {
  const author = interaction.member ? interaction.member.user : interaction.user;
  const { channel } = interaction;
  const guild = channel.guild || null;

  return {
    author,
    channel,
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

function buildInteractionMessage(interaction, text, { cid, connectorName, botName }, parsed) {
  const { author, channel, data } = describeInteraction(interaction, { connectorName, botName });

  return {
    text,
    cid,
    uid: author.id,
    channel: channel.id,
    type: 'command',
    timeReceived: Date.now(),
    data: {
      ...data,
      command: parsed.command,
      args: parsed.args,
      ...(parsed.target ? { target: parsed.target } : {}),
    },
  };
}

function buildComponentMessage(interaction, { cid, connectorName, botName }, parsed) {
  const { author, channel, data } = describeInteraction(interaction, { connectorName, botName });
  const { message } = interaction;
  const started = message && message.interaction;

  return {
    text: parsed.id,
    cid,
    uid: author.id,
    channel: channel.id,
    type: 'component',
    timeReceived: Date.now(),
    data: {
      ...data,
      pluginCid: parsed.cid,
      componentId: parsed.id,
      messageId: message ? message.id : null,
      invokerId: started && started.user ? started.user.id : null,
    },
  };
}

function createInteractionHandler({
  relay,
  getCommands,
  send,
  buildMessage,
  isAllowed = () => true,
  prefix = '.',
}) {
  const commandList = () => Array.from(getCommands().values());

  const readTarget = (interaction) => {
    const { data } = interaction;
    if (data.type === CHAT_INPUT) {
      const found = findChatCommand(commandList(), data);
      return found ? { ...found, resolved: data.resolved } : null;
    }

    const menu = findMenuCommand(commandList(), data);
    if (!menu) return null;
    if (data.type === USER_MENU) {
      return {
        command: menu.command,
        options: [{ name: menu.arg, value: data.target_id }],
        target: { type: 'user', id: data.target_id },
      };
    }

    const messages = data.resolved && data.resolved.messages;
    const found = messages && messages.get(data.target_id);
    return {
      command: menu.command,
      options: [{ name: menu.arg, value: found ? found.content : '' }],
      target: {
        type: 'message',
        id: data.target_id,
        authorId: found && found.author ? found.author.id : null,
      },
      empty: !found || !found.content,
    };
  };

  return async function handle(interaction) {
    if (interaction.type === AUTOCOMPLETE) {
      if (interaction.data) await interaction.result(suggestions(commandList(), interaction.data));
      return;
    }
    if (interaction.type !== APPLICATION_COMMAND || !interaction.data) return;
    if (![CHAT_INPUT, USER_MENU, MESSAGE_MENU].includes(interaction.data.type)) return;

    const read = readTarget(interaction);
    if (!read) {
      await interaction.createMessage({ content: 'That command does not exist any more.', flags: EPHEMERAL });
      return;
    }
    const { command } = read;
    if (!command.online) {
      await interaction.createMessage({ content: 'That command is not available right now.', flags: EPHEMERAL });
      return;
    }
    if (read.empty) {
      await interaction.createMessage({ content: NO_TEXT, flags: EPHEMERAL });
      return;
    }

    const text = commandText(prefix, command, read.options, read.resolved);
    const args = commandArgs(command, read.options, read.resolved);
    const message = buildMessage(interaction, text, {
      command: command.name,
      args,
      ...(read.target ? { target: read.target } : {}),
    });
    if (!isAllowed(command, message)) {
      await interaction.createMessage({ content: 'That command is not available here.', flags: EPHEMERAL });
      return;
    }

    const ephemeral = command.private === true || args.private === true;
    await interaction.defer(ephemeral ? EPHEMERAL : 0);
    relay.track(interaction, { ephemeral });
    await send(message);
  };
}

function createComponentHandler({ relay, send, buildMessage }) {
  return async function handleComponent(interaction) {
    if (interaction.type !== MESSAGE_COMPONENT || !interaction.data) return false;
    const parsed = utils.parseComponentCustomId(interaction.data.custom_id);
    if (!parsed) return false;

    await interaction.deferUpdate();
    relay.track(interaction, { component: true });
    await send(buildMessage(interaction, parsed));
    return true;
  };
}

function createPageHandler({ pager }) {
  return async function handlePage(interaction) {
    if (interaction.type !== MESSAGE_COMPONENT || !interaction.data) return false;
    const parsed = pager.parse(interaction.data.custom_id);
    if (!parsed) return false;

    const opened = pager.open(parsed.key, parsed.index);
    if (!opened) {
      await interaction.editParent({ components: [] });
      await interaction.createFollowup({ content: EXPIRED, flags: EPHEMERAL });
      return true;
    }
    await interaction.editParent({ embeds: opened.embeds, components: opened.components });
    return true;
  };
}

module.exports = {
  EPHEMERAL,
  EXPIRED,
  NO_BUTTON_RESPONSE,
  NO_RESPONSE,
  NO_TEXT,
  buildComponentMessage,
  buildInteractionMessage,
  createComponentHandler,
  createInteractionHandler,
  createPageHandler,
  createRelay,
};

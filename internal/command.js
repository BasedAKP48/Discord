class Command {
  constructor(options) {
    this.alias = Array.isArray(options.alias) ? options.alias : [options.alias];
  }

  get name() {
    return this.constructor.name;
  }

  get commands() {
    return this.alias;
  }

  /**
   * Called by discord
   * @public
   */
  getMessage(options) {
    return new Promise((res) => {
      const data = this.runCommand(options);
      if (!data || (!Object.keys(data).length && data.constructor === Object)) throw new Error('Data not available');
      res(data);
    });
  }

  /**
   * @private
   */
  runCommand(options) {
    throw new Error(`${this.name || 'command'}#runCommand must be overridden`);
  }
}

module.exports = Command;

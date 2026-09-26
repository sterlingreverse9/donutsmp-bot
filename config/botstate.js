let isBotActive = true;

module.exports = {
    getBotStatus: () => isBotActive,
    setBotStatus: (status) => { isBotActive = status; }
};

const { App } = require('@slack/bolt');
const sound = require("sound-play");

// Initializes your app with your bot token and signing secret
const app = new App({
    socketMode: true,
    appToken: process.env.APP_TOKEN,
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const reply = async (cb, msg) => {
    const postAsSlackBot = process.env.POST_AS_SLACKBOT;
    if (postAsSlackBot == 'true') {
        await cb(msg);
        console.log(msg);
    } else {
        console.log(msg);
    }
}

// Missing Stuff:
// Whitelist
// Fuzzy Search + Response with similar sounds

(async () => {
    const playRegex = /^(play)\s+(.*)/;

    await app.start(process.env.PORT || 3009);

    app.message('knock knock', async ({ message, say }) => {
        await reply(say, `_Who's there?_`);
        sound.play("sounds/kungfury/knockles.mp3");
    })

    app.message('help', async ({ message, say }) => {
        await reply(say, "```Commands: \n play <path to sound> \n knock knock```");
    })

    app.message(playRegex, async ({ message, say }) => {
        const match = message.text.match(playRegex);
        await reply(say, `Attempting to play sounds/${match[2]}.mp3`);
        sound.play(`sounds/${match[2]}.mp3`);
    })
    
    console.log('Slack Racket is running! (⚡️ Bolt)');
})();
// Missing Stuff - In priority order:
// Listen to private channels (Currently only seems to work in public channels?)
// User Whitelist/Alias List in google sheets
// Channel whitelist in google sheets
// Channel listen / active list
// Prevent sounds from playing while other sounds are playing https://www.npmjs.com/package/get-mp3-duration
    // Allow other commands to run other than playing sounds while paused
// Speak command connected to amazon polly?
// Max sound length config
// Random-ish responses

// Fuzzy Search? "Did you mean....?"

require('dotenv').config();
const { App } = require('@slack/bolt');
const sound = require('sound-play');
const fs = require('fs');
const path = require('path');
// import FuzzySearch from 'fuzzy-search';

// Initializes your app with your bot token and signing secret
const app = new App({
    socketMode: true,
    appToken: process.env.APP_TOKEN,
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const getDirectories = srcPath => {
    try {
        return fs.readdirSync(srcPath).filter(file => fs.statSync(path.join(srcPath, file)).isDirectory());
    } catch {
        return `Path does not exist: ${srcPath}`;
    }
};
const getFiles = srcPath => {
    try {
        return fs.readdirSync(srcPath).filter(file => !fs.statSync(path.join(srcPath, file)).isDirectory());
    } catch {
        return `Path does not exist: ${srcPath}`;
    }
};

const findInDir = (dir, filter, fileList = []) => {
    const files = fs.readdirSync(dir);

    files.forEach((file) => {
        const filePath = path.join(dir, file);
        const fileStat = fs.lstatSync(filePath);

        if (fileStat.isDirectory()) {
            findInDir(filePath, filter, fileList);
        } else if (filter.test(filePath)) {
            fileList.push(filePath);
        }
    });

    return fileList;
};

const formatFileListForSlack = (files,page=1,pageSize=50) => {
    page = +page;
    if (typeof page != 'number') {
        page = 1;
    }
    const index = (page - 1) * pageSize;
    const pagination = files.length > pageSize ?
        `\nPage ${page} of ${Math.ceil(files.length % pageSize ? Math.floor(files.length / pageSize) + 1 : files.length / pageSize)}`
        : '';
    files = files.slice(index, index + pageSize);
    if (files.length) {
        const fileList = "```" +JSON.stringify(files).replace(/\,/g, ', ').replace(/\[|\]|\"/g, '') + "```";
        return fileList+pagination;
    } else {
        return 'Page not found.';
    }
};

const knockKnock = async ({say}) => {
    await say(`_Who's there?_`);
    sound.play("sounds/kungfury/knockles.mp3");
};

const playHelp = async ({ message, say }) => {
    await say("```Commands: \n play <sound> \n play list <folder> \n play listdir \n play search <search>```");
};

const listRegex = /^(play listdir|play list)(?:\s+|)([^\d\s]+)?(?:\s+|)(\d+)?/;
const list = async ({message, say}) => {
    let reply = '';
    const [,dirMatch,searchFolder,page] = message.text.match(listRegex);
    if (!searchFolder || dirMatch == 'play listdir') {
        // Reply with all directories
        const directories = getDirectories('./sounds');
        if (directories instanceof Array) {
            reply = formatFileListForSlack(directories,page,50);
        } else {
            reply = directories;
        }
    } else {
        // Reply with files in a given folder
        let files = getFiles('./sounds/' + searchFolder);
        if (files instanceof Array) {
            files = files.map((file) => file.replace('.mp3', ''));
            reply = formatFileListForSlack(files, page);
        } else {
            reply = files;
        }
    }
    if (reply) {
        await say(reply);
    }
};

const searchRegex = /^(?:play search)\s+([a-zA-Z0-9_\-\/]+)(?:\s+|)(\d+)?/;
const search = async ({message, say}) => {
    const [,search,page] = message.text.match(searchRegex);
    if (!search) {
        await say(`Yeah, I can't search for nothing... did you mean \`play list\`?`);
        return;
    }
    const files = findInDir('./sounds/', new RegExp(search));
    const numFiles = files.length;

    if (numFiles === 0) {
        await say(`Hmm... I couldn't find anything with this term: \`${search}\``);
        return;
    }
    if (numFiles >= 1) {
        await say(`${numFiles} result(s) for \`${search}\`! \n` + formatFileListForSlack(files,page));
    }
};


const playRegex = /^(?:play)\s+([a-zA-Z0-9_\-\/]+)/;
const play = async ({ message, say }) => {
    const [,search] = message.text.match(playRegex);

    const files = findInDir('./sounds/', new RegExp(search + '\.mp3$'));
    const numFiles = files.length;

    if (numFiles === 0) {
        await say(`Hmm... I couldn't find: \`${search}\``);
        return;
    }
    if (numFiles === 1) {
        await say(`Playing ${files[0]}`);
        sound.play(`${files[0]}`);
    }
    if (numFiles > 1) {
        await say(`Okay, here's the thing... I found ${numFiles} results ending with \`${search}\`, can you be more specific? \n` + formatFileListForSlack(files));
    }

};

// Reactive mapping
const messageMap = [
    { match: 'knock knock', cb: knockKnock },
    { match: 'play help', cb: playHelp },
    { match: listRegex, cb: list},
    { match: searchRegex, cb: search},
    { match: playRegex, cb: play},
];


/**
 * This filters through the messageMap recursively, continuing through the list every time a match is found and returns a positive
 * value, otherwise it stops after it finds its first match. 
 * @param {*} param0 
 * @param {*} index 
 * @returns void
 */
const messageMiddleware = async function ({ message, say }, index = 0) {
    console.log(message.user + ':', message.text);
    const messageMapSlice = messageMap.slice(index);
    const matchIdx = messageMapSlice.findIndex(messageMatch => {
        const msg = message.text || '', type = typeof messageMatch.match;
        if (messageMatch.match && type == 'string') {
            return msg.includes(messageMatch.match);
        }
        if (type == 'function') {
            return messageMatch.match(msg);
        }
        if (messageMatch.match instanceof RegExp) {
            return messageMatch.match.test(msg);
        }
    });
    if (matchIdx < 0) return;
    const match = messageMapSlice[matchIdx];
    const safeSay = async (msg) => {
        const postAsSlackBot = process.env.REPLY_ENABLED;
        if (/true/i.test(postAsSlackBot)) {
            await say(msg);
            console.log(msg);
        } else {
            console.log(msg);
        }
    };
    const proceed = await match.cb({message, say: safeSay});
    if (proceed) {
        messageMiddleware({message, say}, matchIdx + index + 1);
    }
};

(async () => {

    await app.start(process.env.PORT || 3009);

    app.message(messageMiddleware);
    
    console.log('Slack Racket is running! (⚡️ Bolt)');
})();
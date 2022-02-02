// Missing Stuff - In priority order:
// User Allowlist/Alias List in google sheets
// Channel allowlist in google sheets
// Random-ish responses
// Listen to private channels (Currently only seems to work in public channels?)
// Channel listen / active list
// Fuzzy Search? "Did you mean....?"

// Replace this with a google sheet
const userList = {
    'U0KARF25A': 'jefferyjones',
    'ULZMECW5R': 'bradenvw',
    'U02B5UC52': 'bill',
    'U01KVDKNFRP': 'phil',
    'U01K4SGU11P': 'kevin',
    'U41KEM8UB': 'sebastian'
};

const onlyAllowRecognizedUsers = true;
const maxSoundLengthSeconds = 15;

// Replace this with a google sheet
const rateLimitMsList = {
    'U0KARF25A': 5000,
    'default': 10000
};

require('dotenv').config();

const envBool = (str) => {
    return /true/i.test(process.env[str]);
}

const { exec } = require('child_process')
const { App } = require('@slack/bolt');

// Amazon Polly
const AWS = require("aws-sdk");
const uuid = require('uuid');

// Node
const fs = require('fs');
const path = require('path');
const http = require('https');

// MP3 Stuff
const sound = require('sound-play');
const getMP3Duration = require('get-mp3-duration');

// Other
// import FuzzySearch from 'fuzzy-search';
const WebSocket = require('ws')
let wss = { on: () => console.log('Websocket server is not on but attempted to run methods.') }
if (envBool('IS_SERVER')) {
    wss = new WebSocket.Server({ port: process.env.WS_PORT })
}


if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && envBool('ENABLE_SPEAK')) {
    AWS.config.getCredentials(function(err) {
        if (err) { 
            // credentials not loaded
            console.log(err.stack);
        } else {
            console.log("AWS Credentials Loaded for Speak Commands");
        }
    });
    AWS.config.update({ region: 'us-east-1' });
}

// Initializes your app with your bot token and signing secret
let app;
if(envBool('IS_SERVER')) {
    app = new App({
        socketMode: true,
        appToken: process.env.APP_TOKEN,
        token: process.env.SLACK_BOT_TOKEN,
        signingSecret: process.env.SLACK_SIGNING_SECRET,
    });
}

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

const speakRegex = /^(?:speak)\s+([a-zA-Z0-9_\-\/ \?\!\.\,]+)/;
const speak = async ({ message, say }) => {
    if (!envBool('ENABLE_SPEAK')) {
        console.log('Speak commands not enabled.');
        return;
    }
    if (fs.existsSync('./tmp/lock')) {
        const timeTilUnlock = ((Number(fs.readFileSync('./tmp/lock', 'utf8')) - Date.now()) / 1000).toFixed(1);
        if (timeTilUnlock > 0) {
            say(`Sorry, you need to wait for the other sounds to stop.. Try again in ${timeTilUnlock} seconds`)
            return;
        }
    }
    if (fs.existsSync('./tmp/' + message.user + '-lock')) {
        const timeTilUnlock = ((Number(fs.readFileSync('./tmp/' + message.user + '-lock', 'utf8')) - Date.now()) / 1000).toFixed(1);
        if (timeTilUnlock > 0) {
            say(`You need to wait to send another sound command.. Try again in ${timeTilUnlock} seconds`)
            return;
        }
    }

    const [,speech] = message.text.match(speakRegex);
    const speechParams = {
        OutputFormat: "mp3",
        SampleRate: "16000",
        Text: speech,
        TextType: "text",
        VoiceId: "Brian"
    };
    
    // Create the Polly service object and presigner object
    const polly = new AWS.Polly({apiVersion: '2016-06-10'});
    const signer = new AWS.Polly.Presigner(speechParams, polly)
    
    // Create presigned URL of synthesized speech file
    signer.getSynthesizeSpeechUrl(speechParams, function(error, url) {
        if (error) {
            console.log(error.stack);
        } else {
            const file = fs.createWriteStream("./tmp/speech.mp3");
            http.get(url, function(response) {
                response.pipe(file);
                const path = './tmp/speech.mp3';
                playFile({ message, say, path });
            });
        }
    });
};

const playFile = ({ message, say, path }) => {
    const buffer = fs.readFileSync(path);
    const fullSoundDuration = getMP3Duration(buffer);
    const duration = Math.min(fullSoundDuration, maxSoundLengthSeconds * 1000);
    fs.writeFileSync('./tmp/lock', String(Date.now() + duration), 'utf8');
    
    playing = sound.play(`${path}`).catch(() => console.log('Sound stopped early!'));
    if (fullSoundDuration > maxSoundLengthSeconds * 1000) {
        setTimeout(() => {
            const stopCommand = process.platform === 'darwin' ? `killall afplay` : `Start-Sleep 1; Start-Sleep -s $player.NaturalDuration.TimeSpan.TotalSeconds;Exit;`;
            // Not sure if this works on windows or not, works fine on mac though. Also might be worth not using killall but targeting the specific process :shrug:
            // Also, this is kind of hacky, maybe we should use a different play library so we can cancel the sound better.
            exec(stopCommand);
        }, maxSoundLengthSeconds * 1000)
        
    }

    setTimeout(() => { 
        if (fs.existsSync('./tmp/lock')) { 
            fs.unlinkSync('./tmp/lock');
        }
    }, duration);

    const rateLimitMs = getUserRateLimit(message.user);
    fs.writeFileSync('./tmp/' + message.user + '-lock', String(Date.now() + rateLimitMs), 'utf8');
    setTimeout(() => { 
        if (fs.existsSync('./tmp/' + message.user + '-lock')) { 
            fs.unlinkSync('./tmp/' + message.user + '-lock');
        }
    }, rateLimitMs);
}

const playRegex = /^(?:play)\s+([a-zA-Z0-9_\-\/]+)/;
const play = async ({ message, say }) => {
    if (fs.existsSync('./tmp/lock')) {
        const timeTilUnlock = ((Number(fs.readFileSync('./tmp/lock', 'utf8')) - Date.now()) / 1000).toFixed(1);
        if (timeTilUnlock > 0) {
            say(`Sorry, you need to wait for the other sounds to stop.. Try again in ${timeTilUnlock} seconds`)
            return;
        }
    }
    if (fs.existsSync('./tmp/' + message.user + '-lock')) {
        const timeTilUnlock = ((Number(fs.readFileSync('./tmp/' + message.user + '-lock', 'utf8')) - Date.now()) / 1000).toFixed(1);
        if (timeTilUnlock > 0) {
            say(`You need to wait to send another sound command.. Try again in ${timeTilUnlock} seconds`)
            return;
        }
    }
    const [,search] = message.text.match(playRegex);

    const files = findInDir('./sounds/', new RegExp(search + '\.mp3$'));
    const numFiles = files.length;

    if (numFiles === 0) {
        await say(`Hmm... I couldn't find: \`${search}\``);
        return;
    }
    if (numFiles === 1) {
        const path = files[0];
        await say(`Playing ${path}`);
        playFile({ message, say, path });
    }
    if (numFiles > 1) {
        await say(`Okay, here's the thing... I found ${numFiles} results ending with \`${search}\`, can you be more specific? \n` + formatFileListForSlack(files));
    }

};

const findUser = (user) => {
    if (userList[user]) {
        return userList[user];
    }
    return null;
};

const getUserRateLimit = (user) => {
    if (rateLimitMsList[user] >= 0) {
        return rateLimitMsList[user];
    }
    return rateLimitMsList['default'];
}


// Reactive mapping
const messageMap = [
    { match: 'knock knock', cb: knockKnock },
    { match: 'play help', cb: playHelp },
    { match: listRegex, cb: list},
    { match: searchRegex, cb: search},
    { match: playRegex, cb: play},
    { match: speakRegex, cb: speak}
];

const clients = []
let lastMessageTs = 0

/**
 * This filters through the messageMap recursively, continuing through the list every time a match is found and returns a positive
 * value, otherwise it stops after it finds its first match. 
 * @param {*} param0 
 * @param {*} index 
 * @returns void
 */
const messageMiddleware = async ({ message, say }, index = 0) => {
    
    // Prevent old messages from triggering sounds
    messageTs = parseFloat(message.ts)
    if (lastMessageTs >= messageTs) {
        return;
    }
    lastMessageTs = messageTs

    // Send messages to clients / prevent duplicate timestamps
    if (envBool('IS_SERVER') && lastMessageTs >= messageTs) {
        clients.forEach((ws) => {
            ws.send(JSON.stringify(message));
        });
    }
    
    // Process found users and potentially prevent unrecognized users from playing sounds
    const foundUser = findUser(message.user);
    if (!foundUser) {
        console.log('[Unrecognized] ' + message.user + ':', message.text);
    } else {
        console.log(foundUser + ':', message.text);
    }
    if (!foundUser && onlyAllowRecognizedUsers) {
        return;
    }

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
        const postAsSlackBot = envBool('REPLY_ENABLED') && envBool('IS_SERVER');
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

wss.createUniqueID = function () {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    }
    return s4() + s4() + '-' + s4();
};

const connectToServer = async () => {
    const clientConnection = new WebSocket(process.env.WS_URL);

    clientConnection.onopen = () => {
        console.log('WebSocket Client Connected');
      };
    clientConnection.onmessage = (evt) => {
        messageMiddleware({ message: JSON.parse(evt.data) });
    };
}

(async () => {
    if (fs.existsSync('./tmp/lock')) { 
        fs.unlinkSync('./tmp/lock');
    }

    fs.readdirSync('./tmp')
        .filter(file => file.endsWith('-lock'))
        .forEach(file => fs.unlinkSync('./tmp/' + file));
    
    if (envBool('IS_SERVER')) {
        await app.start(process.env.PORT || 3009);

        console.log('Websockets at port: ' + process.env.WS_PORT)

        wss.on('connection', ws => {
            ws.id = wss.createUniqueID();
            clients.push(ws)
            let getActiveClients = () => { return clients.map(client => client.id).join(', ')}
    
            console.log('[Server] New connection: ' + ws.id)
            console.log('[Server] Active Clients: ' + getActiveClients())
    
            ws.on('message', msg => {
              console.log(`[Server] ${ws.id} => ${msg}`)
            })
    
            ws.on('close', () => {
                clients.splice(clients.indexOf(ws), 1)
                console.log('[Server] Client disconnected: ' + ws.id)
                console.log('[Server] Active Clients: ' + getActiveClients())
            })        
        })
        app.message(messageMiddleware);
    } else {
        console.log('client running')
        await connectToServer();
    }
    
    console.log('Slack Racket is running! (⚡️ Bolt)');
})();
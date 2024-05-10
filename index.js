import NodeCache from 'node-cache'
import makeWASocket, {
    DisconnectReason, fetchLatestBaileysVersion, getAggregateVotesInPollMessage,
    makeCacheableSignalKeyStore, isJidBroadcast
} from '@whiskeysockets/baileys'

import logger from './logs.js'
import useMySQLAuthState from './useMySQLAuthStore.js';


const doReplies = !process.argv.includes('--no-reply')

// external map to store retry counts of messages when decryption/encryption fails
// keep this out of the socket itself, so as to prevent a message decryption/encryption loop across socket restarts
const msgRetryCounterCache = new NodeCache()

// start a connection
const startSock = async () => {
    const { state, saveCreds } = await useMySQLAuthState('bot_teste_123', true)
    // fetch latest version of WA Web
    const { version, isLatest } = await fetchLatestBaileysVersion()
    console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)


    const sock = makeWASocket.default({
        version,
        logger,
        printQRInTerminal: true,
        auth: {
            creds: state.creds,
            /** caching makes the store faster to send/recv messages */
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        msgRetryCounterCache,
        generateHighQualityLinkPreview: true,
        // ignore all broadcast messages -- to receive the same
        // comment the line below out
        shouldIgnoreJid: jid => isJidBroadcast(jid),
        // implement to handle retries & poll updates
    })

    const sendMessageWTyping = async (msg, jid) => {
        await sock.sendMessage(jid, msg)
    }

    // the process function lets you process all events that just occurred
    // efficiently in a batch
    sock.ev.process(
        // events is a map for event name => event data
        async (events) => {
            // something about the connection changed
            // maybe it closed, or we received all offline message or connection opened
            if (events['connection.update']) {
                const update = events['connection.update']
                const { connection, lastDisconnect } = update
                if (connection === 'close') {
                    // reconnect if not logged out
                    if ((lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut) {
                        startSock()
                    } else {
                        console.log('Connection closed. You are logged out.')
                    }
                }

                console.log('connection update', update)
            }

            // credentials updated -- save them
            if (events['creds.update']) {
                await saveCreds()
            }

            if (events.call) {
                console.log('recv call event', events.call)
            }

            // history received
            if (events['messaging-history.set']) {
                const { chats, contacts, messages, isLatest } = events['messaging-history.set']
                console.log(`recv ${chats.length} chats, ${contacts.length} contacts, ${messages.length} msgs (is latest: ${isLatest})`)
            }

            // received a new message
            if (events['messages.upsert']) {
                const upsert = events['messages.upsert']
                console.log('recv messages ', JSON.stringify(upsert, undefined, 2))

                if (upsert.type === 'notify') {
                    for (const msg of upsert.messages) {
                        if (!msg.key.fromMe && doReplies) {
                            console.log('replying to', msg.key.remoteJid)
                            await sock.readMessages([msg.key])
                            await sendMessageWTyping({ text: 'Hello there!' }, msg.key.remoteJid)
                        }
                    }
                }
            }

            // messages updated like status delivered, message deleted etc.
            if (events['messages.update']) {
                console.log(
                    JSON.stringify(events['messages.update'], undefined, 2)
                )

                for (const { key, update } of events['messages.update']) {
                    if (update.pollUpdates) {
                        const pollCreation = await getMessage(key)
                        if (pollCreation) {
                            console.log(
                                'got poll update, aggregation: ',
                                getAggregateVotesInPollMessage({
                                    message: pollCreation,
                                    pollUpdates: update.pollUpdates,
                                })
                            )
                        }
                    }
                }
            }

            if (events['message-receipt.update']) {
                console.log(events['message-receipt.update'])
            }

            if (events['messages.reaction']) {
                console.log(events['messages.reaction'])
            }

            if (events['presence.update']) {
                console.log(events['presence.update'])
            }

            if (events['chats.update']) {
                console.log(events['chats.update'])
            }

            if (events['contacts.update']) {
                for (const contact of events['contacts.update']) {
                    if (typeof contact.imgUrl !== 'undefined') {
                        const newUrl = contact.imgUrl === null
                            ? null
                            : await sock.profilePictureUrl(contact.id).catch(() => null)
                        console.log(
                            `contact ${contact.id} has a new profile pic: ${newUrl}`,
                        )
                    }
                }
            }

            if (events['chats.delete']) {
                console.log('chats deleted ', events['chats.delete'])
            }
        }
    )

    return sock
}

startSock()

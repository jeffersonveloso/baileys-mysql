import fs from 'fs/promises';
import path from 'path';
import { WAProto as proto, initAuthCreds, BufferJSON } from "@whiskeysockets/baileys";
import getDbConnection from "./db.js";

export default async function useMySQLAuthState(sessionID, saveOnlyCreds = false) {
    const localFolder = path.join(process.cwd(), 'sessions', sessionID);
    const localFile = (key) => path.join(localFolder, (fixFileName(key) + '.json'));
    if (saveOnlyCreds) await fs.mkdir(localFolder, { recursive: true });

    async function writeData(data, key) {
        const dataString = JSON.stringify(data, BufferJSON.replacer);

        if (saveOnlyCreds && key != 'creds') {
            await fs.writeFile(localFile(key), dataString);
            return;
        }
        await insertOrUpdateAuthKey(sessionID, key, dataString);
        return;
    }

    async function readData(key) {
        try {
            let rawData = null;

            if (saveOnlyCreds && key != 'creds') {
                rawData = await fs.readFile(localFile(key), { encoding: 'utf-8' });
            } else {
                rawData = await getAuthKey(sessionID, key);
            }

            const parsedData = JSON.parse(rawData, BufferJSON.reviver);
            return parsedData;
        } catch (error) {
            console.log('❌ readData', error.message);
            return null;
        }
    }

    async function removeData(key) {
        try {
            if (saveOnlyCreds && key != 'creds') {
                await fs.unlink(localFile(key));
            } else {
                await deleteAuthKey(sessionID, key);
            }
        } catch (error) {
            // Não fazer nada em caso de erro
        }
    }

    let creds = await readData('creds');
    if (!creds) {
        creds = initAuthCreds();
        await writeData(creds, 'creds');
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(value, key) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => {
            return writeData(creds, 'creds');
        }
    };
}

const fixFileName = (file) => {
    if (!file) {
        return undefined;
    }
    const replacedSlash = file.replace(/\//g, '__');
    const replacedColon = replacedSlash.replace(/:/g, '-');
    return replacedColon;
};

async function insertOrUpdateAuthKey(botId, keyId, keyJson) {
    const db = await getDbConnection();

    const selectQuery = `SELECT id FROM auth_keys WHERE session_id = ? AND key_id = ?`;
    const [rows] = await db.execute(selectQuery, [botId, keyId]);

    if (rows.length > 0) {
        const updateQuery = `UPDATE auth_keys SET key_json = ?, updated_at = NOW() WHERE id = ?`;
        await db.execute(updateQuery, [keyJson, rows[0].id]);
    } else {
        const insertQuery = `INSERT INTO auth_keys (session_id, key_id, key_json) VALUES (?, ?, ?)`;
        await db.execute(insertQuery, [botId, keyId, keyJson]);
    }
}

async function getAuthKey(botId, keyId) {
    const db = await getDbConnection();

    const query = `SELECT key_json FROM auth_keys WHERE session_id = ? AND key_id = ?`;
    const [rows] = await db.execute(query, [botId, keyId]);

    return rows.length > 0 ? rows[0].key_json : null;
}

async function deleteAuthKey(botId, keyId) {
    const db = await getDbConnection();

    const query = `DELETE FROM auth_keys WHERE session_id = ? AND key_id = ?`;
    await db.execute(query, [botId, keyId]);
}

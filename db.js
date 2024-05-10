import mysql from 'mysql2/promise'; // Importa o pacote mysql2
import config from './config.js';

// Configurações de conexão com o banco de dados MySQL
const dbConfig = config;

// Cria uma pool de conexões com o banco de dados MySQL
const pool = mysql.createPool(dbConfig);

// Variável global para armazenar a conexão e checar se a tabela auth_keys já foi criada
let dbConnection = null;
let authKeysTableCreated = false;

// Função que retorna a conexão previamente criada ou cria uma nova conexão se ainda não existir
async function getDbConnection() {
    if (dbConnection) {
        return dbConnection;
    }

    console.log('Criando nova conexão com o banco de dados MySQL');
    dbConnection = await pool.getConnection();

    // Checa se a tabela auth_keys já foi criada
    if (!authKeysTableCreated) {
        try {
            console.log('❗Checando se a tabela auth_keys já existe...');
            const [rows] = await dbConnection.execute(
                `SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_name = 'auth_keys'
                ) AS tableExists`
            );

            const { tableExists } = rows[0];
            // Tabela é criada caso não exista
            if (!tableExists) {
                console.log('❗Criando tabela auth_keys');
                await dbConnection.execute(`
                    CREATE TABLE auth_keys (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        session_id VARCHAR(255),
                        key_id VARCHAR(255),
                        key_json TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                    )
                `);
                console.log('✅ Tabela auth_keys criada com sucesso');
            }

            authKeysTableCreated = true;
        } catch (error) {
            console.error('Erro ao criar a tabela auth_keys:', error);
        }
    }

    return dbConnection;
}

// Exporta a função para ser utilizada em outros módulos
export default getDbConnection;

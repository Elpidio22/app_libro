const initSqlJs = require('sql.js-fts5/dist/sql-asm.js');

let databaseInstance = null;
let databasePromise = null;
let failNextWishlistDelete = null;
let failNextBookUpdate = null;

function normalizeBindings(args) {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !(args[0] instanceof Uint8Array)) {
    return args[0];
  }
  return args;
}

function rowsFor(db, sql, parameters = []) {
  const statement = db.prepare(sql);
  try {
    statement.bind(parameters);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
}

function createExpoDatabase(db) {
  const api = {
    async execAsync(sql) {
      db.run(sql);
    },

    async runAsync(sql, ...args) {
      if (/^\s*DELETE FROM lista_compras/i.test(sql) && failNextWishlistDelete) {
        const error = failNextWishlistDelete;
        failNextWishlistDelete = null;
        throw error;
      }
      if (/^\s*UPDATE mis_libros SET/i.test(sql) && failNextBookUpdate) {
        const error = failNextBookUpdate;
        failNextBookUpdate = null;
        throw error;
      }
      db.run(sql, normalizeBindings(args));
      const lastId = rowsFor(db, 'SELECT last_insert_rowid() AS id')[0]?.id || 0;
      return { changes: db.getRowsModified(), lastInsertRowId: lastId };
    },

    async getFirstAsync(sql, ...args) {
      return rowsFor(db, sql, normalizeBindings(args))[0] || null;
    },

    async getAllAsync(sql, ...args) {
      return rowsFor(db, sql, normalizeBindings(args));
    },

    async withExclusiveTransactionAsync(callback) {
      db.run('BEGIN EXCLUSIVE TRANSACTION');
      try {
        const result = await callback(api);
        db.run('COMMIT');
        return result;
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
    },
  };
  return api;
}

async function openDatabaseAsync() {
  if (!databasePromise) {
    databasePromise = initSqlJs().then((SQL) => {
      databaseInstance = new SQL.Database();
      return createExpoDatabase(databaseInstance);
    });
  }
  return databasePromise;
}

module.exports = {
  openDatabaseAsync: jest.fn(openDatabaseAsync),

  __reset() {
    databaseInstance?.close();
    databaseInstance = null;
    databasePromise = null;
    failNextWishlistDelete = null;
    failNextBookUpdate = null;
  },

  __getState() {
    if (!databaseInstance) throw new Error('La base de datos de prueba aún no fue abierta.');
    const tables = rowsFor(databaseInstance, "SELECT name FROM sqlite_master WHERE type = 'table'")
      .map((row) => row.name);
    const indexes = rowsFor(databaseInstance, "SELECT name FROM sqlite_master WHERE type = 'index'")
      .map((row) => row.name);
    const triggers = rowsFor(databaseInstance, "SELECT name FROM sqlite_master WHERE type = 'trigger'")
      .map((row) => row.name);
    return {
      userVersion: rowsFor(databaseInstance, 'PRAGMA user_version')[0]?.user_version || 0,
      tables: new Set(tables),
      indexes: new Set(indexes),
      triggers: new Set(triggers),
      columns: {
        mis_libros: new Set(rowsFor(databaseInstance, 'PRAGMA table_info(mis_libros)').map((row) => row.name)),
        lista_compras: new Set(rowsFor(databaseInstance, 'PRAGMA table_info(lista_compras)').map((row) => row.name)),
      },
      misLibros: rowsFor(databaseInstance, 'SELECT * FROM mis_libros ORDER BY id'),
      listaCompras: rowsFor(databaseInstance, 'SELECT * FROM lista_compras ORDER BY id'),
    };
  },

  __failNextWishlistDelete(error = new Error('DELETE forzado')) {
    failNextWishlistDelete = error;
  },

  __failNextBookUpdate(error = new Error('UPDATE forzado')) {
    failNextBookUpdate = error;
  },
};

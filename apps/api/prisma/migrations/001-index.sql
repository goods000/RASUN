CREATE TABLE IF NOT EXISTS "ChainEvent" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
 "scope" TEXT NOT NULL,"txHash" TEXT NOT NULL,"logIndex" INTEGER NOT NULL,
 "blockNumber" INTEGER NOT NULL,"blockHash" TEXT NOT NULL,"contractAddress" TEXT NOT NULL,
 "name" TEXT NOT NULL,"args" TEXT NOT NULL,"account1" TEXT,"account2" TEXT,"timestamp" INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ChainEvent_scope_txHash_logIndex_key" ON "ChainEvent"("scope","txHash","logIndex");
CREATE INDEX IF NOT EXISTS "ChainEvent_scope_blockNumber_idx" ON "ChainEvent"("scope","blockNumber");
CREATE INDEX IF NOT EXISTS "ChainEvent_scope_account1_idx" ON "ChainEvent"("scope","account1");
CREATE INDEX IF NOT EXISTS "ChainEvent_scope_account2_idx" ON "ChainEvent"("scope","account2");
CREATE TABLE IF NOT EXISTS "IndexedBlock" (
 "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,"scope" TEXT NOT NULL,"number" INTEGER NOT NULL,"hash" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "IndexedBlock_scope_number_key" ON "IndexedBlock"("scope","number");

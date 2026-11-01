
import db from "../config/database.js";

const institutions = [
  {
    id: "org1",
    name: "FKTP Pengirim",
    mspId: "Org1MSP",
    status: "approved",
    canSend: 1,
    canReceive: 0,
  },
  {
    id: "org2",
    name: "FKRTL Penerima",
    mspId: "Org2MSP",
    status: "approved",
    canSend: 0,
    canReceive: 1,
  },
  {
    id: "org3",
    name: "Institusi Anggota Konsorsium",
    mspId: "Org3MSP",
    status: "approved",
    canSend: 0,
    canReceive: 0,
  },
];

const insertInstitution = db.prepare(`
  INSERT INTO institutions (
    id, name, msp_id, status, can_send, can_receive
  )
  VALUES (
    @id, @name, @mspId, @status, @canSend, @canReceive
  )
  ON CONFLICT(id) DO NOTHING
`);

const seed = db.transaction(() => {
  for (const institution of institutions) {
    insertInstitution.run(institution);
  }
});

seed();

const results = db.prepare(`
  SELECT id, name, msp_id, status, can_send, can_receive
  FROM institutions
  ORDER BY id
`).all();

console.table(results);

db.close();

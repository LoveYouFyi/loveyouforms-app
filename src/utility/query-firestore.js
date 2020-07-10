/*-- Dependencies ------------------------------------------------------------*/
const { db } = require('./../init.js');

/*------------------------------------------------------------------------------
  Query Firestore Collection Document
------------------------------------------------------------------------------*/
module.exports.queryDoc = async (collection, docId) => {
  const gotDoc = await db.collection(collection).doc(docId).get();
  return gotDoc.data();
}

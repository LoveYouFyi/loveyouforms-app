/*------------------------------------------------------------------------------
  Utility helpers for use by cloud functions
------------------------------------------------------------------------------*/
const { db } = require('./../init.js');

const queryDoc = async (collection, docId) => {
  const gotDoc = await db.collection(collection).doc(docId).get();
  return gotDoc.data();
}



/*------------------------------------------------------------------------------
 Exports
------------------------------------------------------------------------------*/
module.exports = {
  queryDoc
}

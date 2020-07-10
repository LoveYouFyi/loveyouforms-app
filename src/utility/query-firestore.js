/*------------------------------------------------------------------------------
  Firestore Queries
------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
const { db } = require('./init.js');

/*------------------------------------------------------------------------------
  Query Document
------------------------------------------------------------------------------*/
module.exports.queryDoc = async (collection, docId) => {
  const doc = await db.collection(collection).doc(docId).get();
  return doc.data();
}

/*------------------------------------------------------------------------------
  Query Document Where...
  Example:
  const getFormFieldsRequired = await db.collection('formField')
    .where('required', '==', true).get();
------------------------------------------------------------------------------*/
module.exports.queryDocWhere = async (collection, field, comparison, value) => {
  const doc = await db.collection(collection)
    .where(field, comparison, value).get();

  return doc;
}

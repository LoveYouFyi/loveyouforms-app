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

/*------------------------------------------------------------------------------
  Update Document... update() method
  Update some fields of a document without overwriting the entire document
------------------------------------------------------------------------------*/
module.exports.queryDocUpdate = (collection, docId, object) =>
  db.collection(collection).doc(docId).update({...object});

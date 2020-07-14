/*------------------------------------------------------------------------------
  Schema-Default Trigger Cloud Functions
  When a new 'doc' is created this adds default fields/schema to it.
------------------------------------------------------------------------------*/

/*-- Dependencies ------------------------------------------------------------*/
const { db, queryDoc, logErrorInfo } = require("./../utility");

/*------------------------------------------------------------------------------
  Export Schema Default Function
------------------------------------------------------------------------------*/
module.exports = (collection, schemaType, env) => async (snapshot, context) => {

  try {

    // Get Default Schema
    const schema = await queryDoc('global', schemaType);

    // Update new doc with default schema
    const appRef = db.collection(collection).doc(context.params.id);
    appRef.set(schema); // update record with 'set' which is for existing doc

    return schema;

  } catch(error) {

    console.error(logErrorInfo(error));

  }

}

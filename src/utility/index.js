/*------------------------------------------------------------------------------
  Utility helpers for use by cloud functions
------------------------------------------------------------------------------*/

/*------------------------------------------------------------------------------
 Log Error Info
------------------------------------------------------------------------------*/
const logErrorInfo = error => ({
  Error: 'Description and source line:',
  description: error,
  break: '**************************************************************',
  Logger: ('Error reported by log enty at:'),
  info: (new Error()),
});


/*------------------------------------------------------------------------------
 Sort Objects Ascending
------------------------------------------------------------------------------*/
// argument 'propKey' value must be of type 'string' or 'number'
const sortObjectsAsc = (array, propKey) => array.sort((a, b) => {
  const value = val => typeof val === 'string' ? val.toUpperCase() : val;
  const valueA = value(a[propKey]);
  const valueB = value(b[propKey]);

  if (valueA > valueB ) return 1;
  if (valueA < valueB) return -1;
  return 0; // if equal
});


/*------------------------------------------------------------------------------
 Object Values by Key
------------------------------------------------------------------------------*/
const objectValuesByKey = (array, propKey) => array.reduce((a, c) => {
  a.push(c[propKey]);
  return a;
}, []);


/*------------------------------------------------------------------------------
 Exports
------------------------------------------------------------------------------*/
module.exports = {
  logErrorInfo,
  sortObjectsAsc,
  objectValuesByKey
}

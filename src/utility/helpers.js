
/*------------------------------------------------------------------------------
 Log Error Info
------------------------------------------------------------------------------*/
module.exports.logErrorInfo = error => ({
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
module.exports.sortObjectsAsc = (array, propKey) => array.sort((a, b) => {
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
module.exports.objectValuesByKey = (array, propKey) => array.reduce((a, c) => {
  a.push(c[propKey]);
  return a;
}, []);


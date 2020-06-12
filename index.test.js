// PASSED TEST: with nothing but following 3 lines, validated jest passing test
test("should be 1", () => {
  expect(1).toBe(1);
});

// Test with Jest
//const main = require("./index");
const firebase = require('@firebase/testing') //<--- You want this to be the top guy!!!
const admin = require('firebase-admin')

const projectId = "loveyou-forms";
process.env.GCLOUD_PROJECT = projectId;
process.env.FIRESTORE_EMULATOR_HOST = "localhost:8000";
let app = admin.initializeApp({projectId})
let db = firebase.firestore(app)


/*
test("Test something", () => {
  expect(main.schemaApp('app', 'schemaApp')).toBe();
});
*/

/*

test("Test something", () => {
  expect(testFileParens.file("./code.lisp.txt")).toBe(true);
});

*/

const admin = require('firebase-admin');
const functions = require("firebase-functions-test");
const { formHandler } = require('./index');



describe("formHandler", () => {
  const testEnv = functions();
  
  // Mock setup
  const mockSet = jest.fn();
  mockSet.mockReturnValue(true);
  jest.mock("firebase-admin", () => ({
    initializeApp: jest.fn(),
    database: () => ({
      ref: jest.fn(path => ({
        set: mockSet
      }))
    })
  }));
  // it("creates a form", () => {
  //   const wrapped = testEnv.wrap();
  //   // Create a test form
  //   const testForm = {}

  //   await wrapped(testForm);

  //   expect(admin.database().ref('').set).toBeCalledWith();
  // })
  it('handles form', async () => {
    const req = { headers: {} };
    const res = {
      end: jest.fn()
    }

    formHandler(req, res)
    expect(res.end).toBeCalled();
  })
})

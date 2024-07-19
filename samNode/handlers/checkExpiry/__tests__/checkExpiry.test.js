const MockDate = require('mockdate');
const { DateTime } = require('luxon');

const { DynamoDBClient, PutItemCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require("@aws-sdk/util-dynamodb");
const checkExpiry = require('../index');
const { createDB, deleteDB, getHashedText } = require('../../../__tests__/setup.js');
const { REGION, ENDPOINT } = require('../../../__tests__/settings');

async function setupDb(TABLE_NAME) {

  const dynamoClient = new DynamoDBClient({
    region: REGION,
    endpoint: ENDPOINT
  });

  const params = {
      TableName: TABLE_NAME,
      Item: {
        pk: {S: 'park'},
        sk: {S: 'Test Park'},
        name: {S: 'Test Park'},
        description: {S: 'x'},
        bcParksLink: {S: 'x'},
        status: {S: 'open'},
        visible: {BOOL: true}
      }
    }
  await dynamoClient.send(new PutItemCommand(params));
 

  const param2 = {
      TableName: TABLE_NAME,
      Item: {
        pk: {S: 'facility::Test Park'},
        sk: {S: 'Parking Lot A'},
        name: {S: 'Parking Lot A'},
        description: {S: 'x'},
        bcParksLink: {S: 'x'},
        status: {S: 'open'},
        visible: {BOOL: true},
        qrcode: {BOOL: true},
        type: {S: 'parking'}
      }
    }
    await dynamoClient.send(new PutItemCommand(param2))
}

describe('checkExpiryHandler', () => {
  const OLD_ENV = process.env.TABLE_NAME;
  let hash
  let TABLE_NAME
  
  
  beforeEach(async () => {
    jest.resetModules();
    hash = getHashedText(expect.getState().currentTestName);
    process.env.TABLE_NAME = hash
    TABLE_NAME = process.env.TABLE_NAME;
    await createDB(hash)
    await setupDb(hash)
  });

  afterEach(async () => {
    await deleteDB(process.env.TABLE_NAME);
    process.env.TABLE_NAME = OLD_ENV; // Restore old environment
  });

  test.each([['AM', '123456710'], ['PM', '123456711'], ['DAY', '123456712']])('should set %s passes from yesterday to expired', async (passType, sk) => {
    const dynamoClient = new DynamoDBClient({
      region: REGION,
      endpoint: ENDPOINT
    })
    const passDate = DateTime.fromISO('2021-12-08T20:00:00.000Z');
    const params = {
        TableName: TABLE_NAME,
        Item: {
          pk: {S: 'pass::Test Park'},
          sk: {S: sk},
          facilityName: {S: 'Parking Lot A'},
          type: {S: passType},
          registrationNumber: {S: sk},
          passStatus: {S: 'active'},
          date: {S: passDate.toISO()}
        }
      }
    await dynamoClient.send(new PutItemCommand(params))

    MockDate.set(new Date('2021-12-19T00:00:00.000Z'));
    await checkExpiry.handler(null, {});
    MockDate.reset();

    const param2 = {
        TableName: TABLE_NAME,
        Key: {
          pk: {S: 'pass::Test Park'},
          sk: {S: sk}
        }
      }
    let res2 = await dynamoClient.send(new GetItemCommand(param2))
    res2 = unmarshall(res2.Item)
    expect(res2.passStatus).toBe('expired');
  });

  test.each([['PM', '123456713'], ['DAY', '123456714']])('should not set %s passes from today to expired', async (passType, sk) => {
    const passDate = DateTime.fromISO('2021-12-08T20:00:00.000Z');
    const dynamoClient = new DynamoDBClient({
      region: REGION,
      endpoint: ENDPOINT
    })
    const params = {
        TableName: TABLE_NAME,
        Item: {
          pk: {S: 'pass::Test Park'},
          sk: {S: sk},
          facilityName: {S: 'Parking Lot A'},
          type: {S: passType},
          registrationNumber: {S: sk},
          passStatus: {S: 'active'},
          date: {S: passDate.toISO()}
        }
      }
    
    await dynamoClient.send(new PutItemCommand(params))
    MockDate.set(new Date('2021-12-08T21:00:00.000Z'));
    await checkExpiry.handler(null, {});
    MockDate.reset();


    const params2 = {
        TableName: TABLE_NAME,
        Key: {
          pk: {S: 'pass::Test Park'},
          sk: {S: sk}
        }
      }
    let result = await dynamoClient.send(new GetItemCommand(params2))  
    result = unmarshall(result.Item)
    expect(result.passStatus).toBe('active');
  });

  test.each([['PM', '123456799'], ['DAY', '123456798']])('should set %s passes from today to expired if it is after 18:00', async (passType, sk) => {
    
    const passDate = DateTime.fromISO('2021-12-08T20:00:00.000Z');
    const dynamoClient = new DynamoDBClient({
      region: REGION,
      endpoint: ENDPOINT
    })
    const params = {
        TableName: TABLE_NAME,
        Item: {
          pk: {S: 'pass::Test Park'},
          sk: {S: sk},
          facilityName: {S: 'Parking Lot A'},
          type: {S: passType},
          registrationNumber: {S: sk},
          passStatus: {S: 'active'},
          date: {S: passDate.toISO()}
        }
      }
    await dynamoClient.send(new PutItemCommand(params))
    MockDate.set(new Date('2021-12-09T03:00:00.000Z'));
    await checkExpiry.handler(null, {});
    MockDate.reset();

    const param2 = {
        TableName: TABLE_NAME,
        Key: {
          pk: {S: 'pass::Test Park'},
          sk: {S: sk}
        }
      }
    let result = await dynamoClient.send(new GetItemCommand(param2))
    result = unmarshall(result.Item) 
    expect(result.passStatus).toBe('expired');
  });

  test('should set AM passes to expired after 12:00', async () => {
    const passDate = DateTime.fromISO('2021-12-08T20:00:00.000Z');
    const dynamoClient = new DynamoDBClient({
      region: REGION,
      endpoint: ENDPOINT
    })
    const params = {
        TableName: TABLE_NAME,
        Item: {
          pk: {S: 'pass::Test Park'},
          sk: {S: '123456715'},
          facilityName: {S: 'Parking Lot A'},
          type: {S: 'AM'},
          registrationNumber: {S: '123456715'},
          passStatus: {S: 'active'},
          date: {S: passDate.toISO()}
        }
      }
    
    await dynamoClient.send(new PutItemCommand(params))

    MockDate.set(new Date('2021-12-08T22:00:00.000Z'));
    await checkExpiry.handler(null, {});
    MockDate.reset();

    const param2 = {
        TableName: TABLE_NAME,
        Key: {
          pk: {S: 'pass::Test Park'},
          sk: {S: '123456715'}
        }
      }
    let result = await dynamoClient.send(new GetItemCommand(param2))
    result = unmarshall(result.Item) 
    expect(result.passStatus).toBe('expired');
  });

  test('should set not AM passes to expired before 12:00', async () => {
    const passDate = DateTime.fromISO('2021-12-08T20:00:00.000Z');
    const dynamoClient = new DynamoDBClient({
      region: REGION,
      endpoint: ENDPOINT
    })
    const params = {
        TableName: TABLE_NAME,
        Item: {
          pk: {S: 'pass::Test Park'},
          sk: {S: '123456716'},
          facilityName: {S: 'Parking Lot A'},
          type: {S: 'AM'},
          registrationNumber: {S: '123456716'},
          passStatus: {S: 'active'},
          date: {S: passDate.toISO()}
        }
      }
    await dynamoClient.send(new PutItemCommand(params));

    MockDate.set(new Date('2021-12-08T16:00:00.000Z'));
    await checkExpiry.handler(null, {});
    MockDate.reset();

    const param2 = {
        TableName: TABLE_NAME,
        Key: {
          pk: {S: 'pass::Test Park'},
          sk: {S: '123456716'}
        }
      }
    let result = await dynamoClient.send(new GetItemCommand(param2))
    result = unmarshall(result.Item); 
    expect(result.passStatus).toBe('active');
  });

});

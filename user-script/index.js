'use strict';
// © 2022 Amazon Web Services, Inc. or its affiliates. All Rights Reserved.
// This work is licensed under a MIT-0 License.

/**
 * Script has two modes:
 * - create: Creates a user and returns an ID Token
 *           Parameters: username password subscriptions stackname1 stackname2
 *           Note: set subscriptions to either A or B or A,B; list the two stacknames from the CloudFormation management console
 *           Invocation Examples:
 *            node index.js create foo bar A,B paywalldemo-userpool-stack-1664564158223 paywalldemo-userpool-stack-1664564106999
 *            node index.js create foo bar A paywalldemo-userpool-stack-1664564158223 paywalldemo-userpool-stack-1664564106999
 *            node index.js create foo bar B paywalldemo-userpool-stack-1664564158223 paywalldemo-userpool-stack-1664564106999
 * 
 * - login: Returns ID Token for an existing user.
 *          Parameters: username password stackname1 stackname2
 *          Invation Example:
 *          node index.js login foo bar paywalldemo-userpool-stack-1664564158223 paywalldemo-userpool-stack-1664564106999
 */

const AWS = require('aws-sdk');
AWS.config.update({'region': 'us-east-1'});
let stack1 = null;
let stack2 = null;

const cognito = new AWS.CognitoIdentityServiceProvider();

/**
 * Call CloudFormation and get the UserPoolId and ClientId from the stack
 * created for the UserPool.
 * @returns { UserPoolId: String, ClientId: String }
 */
async function getPoolInfo(){
    const cloudformation = new AWS.CloudFormation();
    let description = await cloudformation.describeStacks({ 'StackName': stack1 }).promise();
    let ids = {};

    description.Stacks.map(s => {
        if (s.StackName === stack1){
            s.Outputs.map( o => {
                if (o.OutputKey === 'UserPoolId'){
                    ids.UserPoolId = o.OutputValue;
                }
                else if (o.OutputKey === 'ClientId'){
                    ids.ClientId = o.OutputValue;
                }
            } );
        }
    });

    return ids;
}

/**
 * Retrieve the user so we can check if it already exists.
 * 
 * @param {String} username 
 * @param {String} userPoolId 
 * @returns 
 */
async function getUser(username, userPoolId){

    const params = {
      UserPoolId: userPoolId,
      Username: username
    };
    
    try {
        return await cognito.adminGetUser(params).promise();
    }
    catch (e){
        return null;
    }
    
  }

/**
 * Create a user in the user pool. 
 * @param {String} username 
 * @param {String} password 
 * @param {String} subscriptions: comma separated list. Available products are A and B only.
 */
async function createUserReturnIdToken(username, password, subscriptions){
    if (!username || !password || !subscriptions){
        throw new Error('username, password and subscriptions are required');
    }
    let ids = await getPoolInfo();
    let user = await getUser(username, ids.UserPoolId);

    let userParams = {
        UserPoolId: ids.UserPoolId,
        Username: username,
        MessageAction: "SUPPRESS",
        UserAttributes: [ { Name: 'custom:subs', Value: subscriptions } ]
    };

    // Create the user if it does not already exist
    if (!user){
        let createUserResponse = await cognito.adminCreateUser(userParams).promise();
    }
    
    // Set the password (or reset if the user already exists)
    const pwdParams = {
        Password: password, 
        UserPoolId: ids.UserPoolId, 
        Username: username, 
        Permanent: true   
      };    
    let passwordResponse = await cognito.adminSetUserPassword(pwdParams).promise();

    let tokens = await getTokens(username, password, ids.UserPoolId, ids.ClientId);

    return tokens;
}

/**
 * Retrieves the CloudFront Distribution host name from the stack that created
 * that resource so we can list how to call for content.
 */
async function howToCallOrigin(){
    const cloudformation = new AWS.CloudFormation();
    let distributionInfo = await cloudformation.describeStacks({ 'StackName': stack2 }).promise();
    let domain = null;
    distributionInfo.Stacks.map(s => {
        if (s.StackName === stack2){
            s.Outputs.map( o => {
                if (o.OutputKey === 'CFDistributionDomain'){
                     domain = o.OutputValue;
                }
            } );
        }        
    });
    
    if (domain){
        let exampleUrl = 'https://' + domain + '/{product name}/content/{content id}';
        let exampleUrl2 = 'https://' + domain + '/product-a/content/123';
        console.log('Include the ID Token in a cookie named "jwt".');
        console.log('Then submit a request for content using a URL with this format:')
        console.log('   ' + exampleUrl);
        console.log('\nFor example, if retrieving content id \'123\' from Product A, the URL will be:');
        console.log('   ' + exampleUrl2);
    }
}

/**
 * Retrieve the tokens for the user.
 * @param {String} username 
 * @param {String} password 
 * @param {String} userPoolId 
 * @param {String} clientId 
 * @returns {}
 */
async function getTokens(username, password, userPoolId, clientId){
    if (!username || !password){
        throw new Error('username and password are required');
    }

    if (!userPoolId || !clientId){
        let ids = await getPoolInfo();
        userPoolId = ids.UserPoolId;
        clientId = ids.ClientId;
    }

    let params = {
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH', 
      ClientId: clientId,
      UserPoolId: userPoolId,    
      AuthParameters: {
        'USERNAME': username,
        'PASSWORD': password
      }    
    }

    let tokens = await cognito.adminInitiateAuth(params).promise();
    return tokens?.AuthenticationResult?.IdToken;
  }

// Entry point
const args = process.argv.slice(2);
const appMode = args[0];
const username = args[1];
const password = args[2];
const subs = args[3];

// Determine stacks
if (appMode == 'create'){
    stack1 = args[4];
    stack2 = args[5];
}
else {
    stack1 = args[3];
    stack2 = args[4];
}

if (!stack1.startsWith('paywalldemo-userpool-stack')){
    let tmp = stack1;
    stack1 = stack2;    
    stack2 = tmp;
}

if (appMode === 'create'){
    createUserReturnIdToken(username, password, subs)
    .then(token => {
        console.log('Use this ID Token:')
        console.log('--------------------------------------------------');
        console.log(token);
        console.log('--------------------------------------------------\n');
        howToCallOrigin()
        .then()
        .catch();
    })
    .catch(e => {
        console.log(e);
    });
}
else if (appMode === 'login'){
   getTokens(username, password)
   .then( token => {
    console.log('Use this ID Token:')  
    console.log('--------------------------------------------------');      
    console.log(token);
    console.log('--------------------------------------------------\n');
    howToCallOrigin()
    .then()
    .catch();
   })
   .catch( e => {
     console.log(e);
   });
}
else {
    console.log('Unknown mode: specify \'create\' or \'login\'');
}
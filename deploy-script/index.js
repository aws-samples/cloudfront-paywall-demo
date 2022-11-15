'use strict';
// © 2022 Amazon Web Services, Inc. or its affiliates. All Rights Reserved.
// This work is licensed under a MIT-0 License.

/**
 * Script runs two CloudFormation templates. The first creates a Cognito UserPool and 
 * Client. 
 * 
 * Once that is created, the script retrieves and formats the PublicKey from
 * the UserPool and then calls the second Cognito UserPool that creates the CloudFront
 * distribution, the Lambda@Edge function that handles viewer requests, and then another
 * Lambda and API Gateway to serve as an origin.
 */
const fs = require('fs');
const https = require('https');
const jwkToPem = require('jwk-to-pem');
const AWS = require('aws-sdk');
// For this demo, we hard code the region because Lambda@Edge functions must be deployed
// first to us-east-1 and are then replicated globally. This means that the origin server
// and Cognito UserPool will also be deployed to us-east-1. If you have different needs.
// you can create a deploment for the resources that must be in us-east-1 and
// separate deployments for the other resources.
AWS.config.update({'region': 'us-east-1'});
const crypto = require('crypto');

/**
 * Public keys must be put into pem format when validating
 * signatures using the crypto module. This uses the jwk-to-pem
 * npm module to do the conversion.
 * @param {String[]} keysArray 
 * @returns 
 */
function createPemKeys(keysArray){
    let allKeys = {};

    keysArray.map( k => {
        let kid = k.kid;
        let pem = jwkToPem(k);
        allKeys[kid] = pem;
    } );

    return allKeys;
}

/**
 * Calls the well-known URL to get the public keys. The url value
 * was calculated in the CloudFormation template and included as
 * an output value in the CloudFormation stack.
 * @param {String} url 
 * @returns Object
 */
function getKeys(url){
    return new Promise( (resolve, reject) => {

        https.get(url, (res) => {
            
            res.on('data', (d) => {
                try {
                    let str = d.toString();
                    return resolve(JSON.parse(str));
                }
                catch (e){
                    return reject(e);
                }

            })
    
        }).on('error', (error) => {
            return reject(error);
        })  

    } );
}

function generateApiKey(){
    let key = crypto.randomBytes(24).toString('base64');
    return key;
}

/**
 * Main function
 */
async function main(){
    try{
        let ts = Date.now();
        console.log('Beginning deployment')
        const stackName = 'paywalldemo-userpool-stack-' + ts;
        const secondStackName = 'paywalldemo-cfdistribution-stack-' + ts;

        // Read entire template into a string
        let templateBody = fs.readFileSync('./step-1-userpool.yml').toString();
        let secondTemplateBody = fs.readFileSync('./step-2-cfdistribution.yml').toString();
    
        // create user pool
        const cloudformation = new AWS.CloudFormation();
        let userPoolParams = {
            StackName: stackName,
            Capabilities: ['CAPABILITY_AUTO_EXPAND', 'CAPABILITY_IAM'],
            TemplateBody: templateBody,
            Parameters: [
                {
                    ParameterKey: 'ExternalId',
                    ParameterValue: crypto.randomBytes(24).toString('base64')
                }
            ]
        };        
        console.log('Starting creation of the Cognito UserPool');
        let userPoolResult = await cloudformation.createStack(userPoolParams).promise();
        let userPoolCreationDone = await cloudformation.waitFor('stackCreateComplete', { StackName: stackName }).promise();
        console.log('Cognito UserPool created');
        // retrieve the well-known url for the public keys
        console.log('Retrieving and formatting public key from the UserPool');
        let description = await cloudformation.describeStacks({ 'StackName': stackName }).promise();
        let keyUrl = null;
        let apiKeyValue = generateApiKey();
        description.Stacks.map(s => {
            if (s.StackName === stackName){
                s.Outputs.map( o => {
                    if (o.OutputKey === 'UserPoolUrl'){
                        keyUrl = o.OutputValue;
                    }
                } );
            }
        });

        let publicKeys = null;
        let pemKeys = null;

        if (keyUrl){
           console.log('Public key retrieved');
           publicKeys = await getKeys(keyUrl);
           pemKeys = createPemKeys(publicKeys.keys);
        }
        else {
            console.log('Public key could not be retrieved');
        }

        // call the second stack and pass in the pem key so that it is included in the code
        let distributionParams = {
            StackName: secondStackName,
            Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_AUTO_EXPAND'],
            TemplateBody: secondTemplateBody,
            Parameters: [
                {
                    ParameterKey: 'PublicKeys',
                    ParameterValue: JSON.stringify(pemKeys)
                },
                {
                    ParameterKey: 'Environment',
                    ParameterValue: 'dev'
                },
                {
                    ParameterKey: 'ApiKeyValue',
                    ParameterValue: apiKeyValue
                },
                {
                    ParameterKey: 'SuffixValue',
                    ParameterValue: ts + ''
                }
            ]
        };      

        console.log('Creating the CloudFront distribution and the mock origin (this will take several minutes)');
        let distributionResult = await cloudformation.createStack(distributionParams).promise();
        let distributionCreationDone = await cloudformation.waitFor('stackCreateComplete', { StackName: secondStackName }).promise();        
        console.log('CloudFront distribution and origin created');

        let distributionInfo = await cloudformation.describeStacks({ 'StackName': secondStackName }).promise();
        distributionInfo.Stacks.map(s => {
            if (s.StackName === secondStackName){
                s.Outputs.map( o => {
                    if (o.OutputKey === 'CFDistributionDomain'){
                        console.log('==========================================================================');
                        console.log('Use this CloudFront domain name when requesting content: ' + o.OutputValue);
                        console.log('==========================================================================');
                    }
                } );
            }
        });        
    }
    catch (e){
        console.log('Error:');
        console.log(e);
    }

}

main()
.then(r => {
    console.log('Deployment script ending.');
})
.catch (e => {
    console.log('Error:');
    console.log(e);
})


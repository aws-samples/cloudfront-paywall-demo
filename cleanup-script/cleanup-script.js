'use strict';
// © 2022 Amazon Web Services, Inc. or its affiliates. All Rights Reserved.
// This work is licensed under a MIT-0 License.

/**
 * Run this script first to start the cleanup process. This script removes the 
 * Lamda@Edge association with the CloudFront distribution behavior. Disassociating
 * the Lamda@Edge function is required because CloudFront distributions cannot be
 * deleted if they are associated with a function. Updating the CloudFront distribution can 
 * take several minutes, so you will need this script first and wait for it to finish.
 * 
 * Once this script completes, you should wait at least an hour before attempting to
 * run the second script. The wait is necessary because the CloudFront distribution
 * needs to be updated in all edge locations, which can take a significant amount of time.
 */

const AWS = require('aws-sdk');
AWS.config.update({'region': 'us-east-1'});
const cloudfront = new AWS.CloudFront();
const firstStackName = 'paywalldemo-userpool-stack';
let stack1 = null;
let stack2 = null;

/**
 * Retrieve the Id of the distribution from the Output values of the CloudFormation stack that
 * created the CloudFront distribution.
 * 
 * @returns String
 */
async function getDistributionId() {
    let id = null;
    let cloudformation = new AWS.CloudFormation();
    let distributionInfo = await cloudformation.describeStacks({ 'StackName': stack2 }).promise();

    for (let i = 0; i < distributionInfo.Stacks.length; i++){
        let s = distributionInfo.Stacks[i];
        if (s.StackName === stack2){
            s.Outputs.map( o => {
                if (o.OutputKey === 'CFDistributionId'){
                    id = o.OutputValue;                    
                }
            } );
        }        
    }
    
    return id;    
}

/**
 * Retrieve the CloudFront distribution config so that we can update it.
 * 
 * @param {String}} id 
 * @returns Object
 */
async function getDistributionConfig(id){
    let params = {
        Id: id
    }

    let config = await cloudfront.getDistributionConfig(params).promise();
    return config;
}

/**
 * Update the distribution config JSON to remove the associated lambda function
 * and add the Id and the ETag.
 * 
 * @param {String} id 
 * @param {Object} config 
 * @returns Object
 */
function updateConfigJson(id, config){
    let value = config.ETag;
    delete config.ETag;
    config.Id = id;
    config.IfMatch = value;

    let items = config?.DistributionConfig?.CacheBehaviors?.Items;

    if (!items){
        return config;
    }

    for (let i = 0; i < items.length; i++){
        let item = items[i];
        item.LambdaFunctionAssociations = { Quantity: 0, Items: [] };
    }

    return config;
}

/**
 * Updates the CloudFront distribution to remove the associated lamda@edge function
 * so that the entire stack can be deleted.
 * 
 * @param {String} id 
 * @param {Object} config 
 * @returns Object
 */
async function updateDistribution(id, config){
    console.log('Updating CloudFront distribution to remove associated Lambda@Edge function')
    let updatedConfig = updateConfigJson(id, config);
    let response = await cloudfront.updateDistribution(updatedConfig).promise();
    let waitFor = await cloudfront.waitFor('distributionDeployed', { Id: id }).promise();
    return waitFor;
}

async function removeStack(){
    let cloudformation = new AWS.CloudFormation();
    let firstStackResult = await cloudformation.deleteStack({StackName: stack1}).promise();
    let secondStackResult = await cloudformation.deleteStack({StackName: stack2}).promise();
    // Wait for each stack delete to finish, one at a time
    let firstStackDeleteDone = await cloudformation.waitFor('stackDeleteComplete', { StackName: stack1 }).promise();
    let secondStackDeleteDone = await cloudformation.waitFor('stackDeleteComplete', { StackName: stack2 }).promise();    
    return;
}

/**
 * Wait 15 minutes
 */
async function delay(minutes){
    const {setTimeout} = require('timers/promises');
    await setTimeout(minutes * 60 * 1000);
}

/**
 * Check whether the CloudFront distrubition has finished deployment
 * @param {String} distributionId 
 * @param {Number} counter 
 * @returns 
 */
async function distributionIsDeployed(distributionId, counter = 1){
    console.log('Waiting for CloudFront distributions to update in all locations')
    let pause = await delay(15);
    
    let params = {
        Id: distributionId
    }

   let dist = await cloudfront.getDistribution(params).promise();

   let status = dist.Distribution.Status;

   if (status === 'Deployed'){
      return true;
   }
   else if (counter === 3){
    console.log('Maximim period to wait for CloudFront updates to complete has been reached. Please check your CloudFormation stack to see if you need to manually delete resources.');
    return false;
   }
   else {      
      return distributionIsDeployed(distributionId, ++counter);
   }
}

let distributionid = null;

stack1 = process.argv[2];
stack2 = process.argv[3];

if (!stack1 || !stack2 ){
    console.log('Both stack names must be specified on the commandline');
    process.exit(1);
}

// Put the stack names in the right order
if (!stack1.startsWith(firstStackName)){
    let tmp = stack2;
    stack2 = stack1;
    stack1 = tmp;
}

getDistributionId()
.then(id => {
    distributionid = id;
    return getDistributionConfig(distributionid);
})
.then(config => {
    return updateDistribution(distributionid, config);
})
.then(result => {
    return distributionIsDeployed(distributionid);
})
.then(isDeployed =>{
    if (isDeployed){
        return removeStack();
    }
    else {
        console.log('Could not remove the stack because Lambda@Edge functions have not been disassociated from all CloudFront distrubutions.');
        return;
    }   
})
.then(() => {
    console.log('All resources have been removed.')
})
.catch(e => {
    console.log('An error occurred cleaning up resources. Please refer to the following error message.');
    console.log(e);
});
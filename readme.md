# Paywall Demo Scripts
Scripts demonstrate how to combine a paywall with a content distribution network (CDN) using Amazon CloudFront and AWS Lambda@Edge.

This code is not intended to be used in a production environment. It is provided for demonstration purposes only and should be modified before it is used in production.

## Security Considerations
Prior to using this code in a production environment, your local security teams should conduct a security review to ensure that it conforms to your specific security requirements.

### Accessing the Mock Origin API
When deploying a paywall solution to production, you should ensure that the origin only accepts requests from the Lamdba@Edge function running in Amazon CloudFront. Otherwise, malicious users can forge a request with the x-is-subscriber header set to "true" and submit it to the origin, which will then serve all the content.

For this demo, the origin is served by an Amazon API Gateway integrated with an AWS Lambda function. The API Gateway requires an API key included in an x-api-key header. The API Key is created during deployment and is automatically embedded in the Lambda@Edge function. The function then includes the x-api-key header in every request, thus ensuring that all requests are coming from CloudFront. 

### JWT expiration
This demonstration creates three different JWTs: an ID Token, an Access Token and a Refresh Token. The default expiration dates are used for the demonstration, which amount to 30 days for Refresh Tokens, and 1 hour for Access and ID Tokens. 

When deploying to production, users should select the shortest expiration time that meets their business needs. Set custom values using properties of the UserPoolClient in AWS CloudFormation. [Documentation on setting expiration values inside a CloudFormation template is located here](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-cognito-userpoolclient.html). 

### Limiting access to the origin server
Calling the origin server API Gateway will incur usage charges. To prevent accidentally calling the endpoint too many times (perhaps due to a scripting error), the API Gateway endpoint has been configured with a Usage Plan that limits the number of calls that can be made. Currently, only 1000 requests can be made each day against the origin endpoint. If you need to increase the number of calls for testing purposes, then raise the limit in the CloudFormation template.

## Prerequisites
* nodejs v16+
* npm v8+
* AWS Account and IAM user with proper privileges. Use an account with access to the following services:
  * Amazon API Gateway
  * Amazon Cognito User Pools
  * AWS CloudFormation
  * AWS CloudFront
  * AWS IAM
  * AWS Lambda
* AWS region and credentials configured on local machine. Refer to the following:
  * To get credentials: https://docs.aws.amazon.com/general/latest/gr/aws-sec-cred-types.html
  * To create a credentials and config file, refer to: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html 

## Deploying the demo
All the deploy scripts and CloudFormation templates are stored inside the folder named `deploy-script`. Using a terminal, navigate to the folder and follow these steps:

1. If this is the first time, run `npm install` to create the node_modules folder with all dependencies
2. Run `node .`

The index.js script will run and first create a Cognito UserPool (which will issue ID Token) and then it will create the CloudFront distribution and a mock origin server. 

Once the script has run, it will show the domain name of the CloudFront distribution that you will call to retrieve content.

Once the script has finished running, you can create users in the user pool, retrieve an ID Token, and then submit content requests to the CloudFront distribution. See below for more details.

## Creating Users
In order to make content requests, you must create a user, login as that user, and receive a ID Token. With the Token, you can then make requests to the CloudFront distribution for content, which will trigger the paywall logic.

To create a user, do the following:

1. In a console or terminal, navigate into the folder named `user-script`.
2. If this is the first time, run `npm install`.
3. Once installation has finished, enter `node . create {username} {password} {subscription}`
   Replace {username} with a username value you want to create
   Replace {password} with a password value you want to associate with the username
   Replace {subscriptions} with the product(s) you want the user to be able to access. For this demo, use the value "A" or "B" (these are the only products supported by the demo).

The system will create the specified user and then return an ID Token you can use to make content requests.

To make content requests, see the documentation below.

## Login as an Existing User
If you have already created a user, then you can run the script and specify a username and password to receive a JWT.

To login as an existing user, do the following:

1. In a console or terminal, navigate into the folder named `user-script`.
2. Run the command `node . login {username} {password}`
   Replace {username} and {password} with the values you previously created.

The script will return the ID Token you can use to make content requests.

## Making Content Requests
To make content requests, you will need to use a REST client so that you can submit GET requests to the CloudFront Distribution. 

When making requests, set these parameters in the REST client:

* URL: https://{CloudFront distribution domain}/{product name}/content/{content id}
       The user create/login script will return the CloudFront distribution domain to use.
       If retrieving Content ID `123` from `Product A`, the URL will be:
       https://{Cloud Front domain}/product-a/content/123
* Method: GET
* Cookie: jwt={ID Token}

If the user you created has access to the product, the response will be "Full content".

If the user does not have access to the product, the response will be "Preview only".

Note that the first time you request a content item, the call will be sent to the origin. All later calls for the content item will be returned from the CloudFront cache.

### Confirming that Content is Being Cached
You can confirm that the origin is only being called the first time content is requested by checking the Amazon CloudWatch logs created by the origin.

For our demo, we created an API Gateway tied to a Lambda function to serve as the origin. Each time a request is received by the API Gateway, it invokes the Lambda function, which then logs the content URL to CloudWatch. If you make multiple calls to the same content URL, you will see that only the first request for subscribers will be logged, while only the first request by non-subscribers will be logged. All other requests are not logged because they are served directly from cache.

To check the CloudWatch logs, log into the AWS Management Console, then:

1. Select Services > Lambda
2. Click the link for the Lambda function named "PaywallDemoMockOriginFunction-dev"
3. Select the Monitor tab
4. Click the button labeled "View logs in CloudWatch"
5. The CloudWatch Log Group details page will open in your browser and display the messages logged by the Lambda function. You can click through the messages to see when the Lambda function has been triggered.

## Cleanup Scripts
To remove all the resources created for this demo, run the script located in the "cleanup-script" folder.

1. In a terminal, navigate into the folder named "cleanup-script"
2. If this is the first time, run `npm install`
3. Once installation has finished, enter `node cleanup-script <stack name 1> <stack name 2>`. Note that the demonstration creates two separate stacks: one for the Cognito User Pool and a second for the CloudFront distribution. Enter both stack names on the command line, in any order, so that they will be deleted.
4. System will update the CloudFront distribution to remove the associated Lambda@Edge function, and then delete all the resources. 
5. The deletion process can take up to 45 minutes to complete. Once the script finishes running, you can confirm that the cleanup was successful by logging into your AWS Management Console. 
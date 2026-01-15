export const environment = {
  aws: {
    region: 'us-east-2',
  },
  bedrock: {
    // bedrock IAM user access key
    accessKeyId: '',
    secretAccessKey: '',
    modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0',
    inferenceProfileArn:
      'arn:aws:bedrock:us-east-2:189676911188:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0',
  },
  lambdaEndpoints: {
    // need to add lambda endpoint to make it work
    startSemgrepScanUrl:
      'https://gc7wjaaaohowcxbweatwunazwy0ntyzw.lambda-url.us-east-2.on.aws/',
    semgrepScannerLogsUrl:
      'https://btmcvvvdlmgirzlbwa5b4o2xxq0llfdd.lambda-url.us-east-2.on.aws/',
    startHarnessPipelineURL: '',
    harnessLogsURL: '',
    fetchResultUrl:
      'https://4q5qnzzepqwag5qd6dgazwo4ya0ottnq.lambda-url.us-east-2.on.aws/',
  },
  devConfigs: { mockMode: true, skipStartScreen: true },
};

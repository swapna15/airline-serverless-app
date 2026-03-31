exports.handler = async (event) => {
  const { from, to } = event.queryStringParameters;

  return {
    statusCode: 200,
    body: JSON.stringify([
      { id: 1, from, to, price: 200 },
      { id: 2, from, to, price: 250 }
    ])
  };
};
// Preloaded only by the isolated dispatchServer.test child process.
import fixtures from './coverage-address-fixtures.json' with {type:'json'};

const fetchReal = globalThis.fetch;
const replies = ['REQUEST_DENIED', 'ZERO_RESULTS', 'OK', 'OVER_QUERY_LIMIT'];
const fixture = fixtures[0];
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname !== 'maps.googleapis.com') return fetchReal(input,init);
  if (url.pathname !== '/maps/api/geocode/json') throw Error('Unexpected Maps request');
  const status = replies.shift();
  if (!status) throw Error('Unexpected geocoding request');
  if (status === 'OK') return Promise.resolve(Response.json({status,results:[{
    formatted_address:fixture.formattedAddress, geometry:{location:fixture.coordinates},
    address_components:[{long_name:'Bogotá', types:['locality']}, {long_name:'Colombia',short_name:'CO',types:['country']}],
  }]}));
  return Promise.resolve(Response.json({status,results:[],error_message:'PRIVATE_PROVIDER_DETAIL'}));
};

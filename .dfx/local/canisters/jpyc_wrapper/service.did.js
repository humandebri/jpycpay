export const idlFactory = ({ IDL }) => {
  return IDL.Service({ 'name' : IDL.Func([], [IDL.Text], []) });
};
export const init = ({ IDL }) => { return []; };

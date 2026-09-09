/** Boc 1 route handler async, tu dong forward loi cho middleware xu ly loi cua Express. */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;

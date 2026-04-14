export function validateBody(validator) {
    return (req, res, next) => {
        const result = validator(req.body || {}, req);
        if (result?.error) {
            return res.status(400).json({error: result.error});
        }
        req.validatedBody = result?.value ?? req.body ?? {};
        return next();
    };
}

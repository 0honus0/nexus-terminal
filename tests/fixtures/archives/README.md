# Archive protocol vectors

`zipcrypto-header-collision.zip` was created with Info-ZIP 3.0 using the test password
`fixture-correct-password`. It contains `source.txt`, whose bytes are
`CRC evidence for a wrong ZipCrypto password\n` repeated 100 times.

For these exact archive bytes, `incorrect-89` passes ZipCrypto's one-byte header
check but fails payload inflation. Info-ZIP 6.0 returns 2, rather than its usual
wrong-password status 82. The protocol regression verifies the native status,
password refusal before staging, and successful extraction with the correct password.
These passwords are public fixture inputs.

`corrupt-plain.zip` contains the same unencrypted input, with the first compressed
payload byte inverted. Info-ZIP also returns 2 for this file. Its regression
ensures that a damaged unencrypted archive is not misreported as a password failure.

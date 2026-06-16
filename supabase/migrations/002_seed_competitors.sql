-- Seed competitors
INSERT INTO competitors (name, slug, website, is_hustle, color, tier) VALUES
  ('Hustle SG', 'hustle-sg', 'hustle.com.sg', true, '#6366f1', 'High'),
  ('Vertical Institute', 'vertical-institute', 'verticalinstitute.com', false, '#f59e0b', 'High'),
  ('Happy Together', 'happy-together', 'happytogetherparty.com', false, '#10b981', 'Mid'),
  ('Skills Dev Academy', 'skills-dev-academy', 'sda.edu.sg', false, '#3b82f6', 'High'),
  ('ASK Training', 'ask-training', 'asktraining.com.sg', false, '#ef4444', 'Mid'),
  ('OOm Pte Ltd', 'oom-pte-ltd', 'oom.com.sg', false, '#8b5cf6', 'High'),
  ('Heicoders Academy', 'heicoders-academy', 'heicodersacademy.com', false, '#ec4899', 'Mid'),
  ('Equinet Academy', 'equinet-academy', 'equinetacademy.com', false, '#14b8a6', 'Mid'),
  ('BELLS Institute', 'bells-institute', 'bells.sg', false, '#f97316', 'Low'),
  ('InfoTech Academy', 'infotech-academy', 'infotech.edu.sg', false, '#06b6d4', 'Low');

-- Seed social profiles for Hustle SG
INSERT INTO social_profiles (competitor_id, platform, handle, url) VALUES
  ((SELECT id FROM competitors WHERE slug = 'hustle-sg'), 'instagram', '@thehustlesg', 'https://www.instagram.com/thehustlesg/'),
  ((SELECT id FROM competitors WHERE slug = 'hustle-sg'), 'facebook', 'thehustlesg', 'https://www.facebook.com/thehustlesg'),
  ((SELECT id FROM competitors WHERE slug = 'hustle-sg'), 'linkedin', 'company/hustle-singapore', 'https://www.linkedin.com/company/hustle-singapore'),
  ((SELECT id FROM competitors WHERE slug = 'hustle-sg'), 'tiktok', '@thehustlesg', 'https://www.tiktok.com/@thehustlesg');

-- Seed social profiles for Vertical Institute
INSERT INTO social_profiles (competitor_id, platform, handle, url) VALUES
  ((SELECT id FROM competitors WHERE slug = 'vertical-institute'), 'instagram', '@verticalinstitute', 'https://www.instagram.com/verticalinstitute/'),
  ((SELECT id FROM competitors WHERE slug = 'vertical-institute'), 'facebook', 'verticalinstitute', 'https://www.facebook.com/verticalinstitute'),
  ((SELECT id FROM competitors WHERE slug = 'vertical-institute'), 'linkedin', 'school/verticalinstitute', 'https://www.linkedin.com/school/verticalinstitute'),
  ((SELECT id FROM competitors WHERE slug = 'vertical-institute'), 'tiktok', '@verticalinstitute', 'https://www.tiktok.com/@verticalinstitute'),
  ((SELECT id FROM competitors WHERE slug = 'vertical-institute'), 'youtube', 'UCWs8KlqWv6C7JKHE4YIhTRw', 'https://www.youtube.com/channel/UCWs8KlqWv6C7JKHE4YIhTRw');

-- Seed social profiles for Happy Together
INSERT INTO social_profiles (competitor_id, platform, handle, url) VALUES
  ((SELECT id FROM competitors WHERE slug = 'happy-together'), 'instagram', '@happytogetheracademy', 'https://www.instagram.com/happytogetheracademy/'),
  ((SELECT id FROM competitors WHERE slug = 'happy-together'), 'facebook', 'Happytogetherparty', 'https://www.facebook.com/Happytogetherparty'),
  ((SELECT id FROM competitors WHERE slug = 'happy-together'), 'linkedin', 'company/happytogetherparty', 'https://www.linkedin.com/company/happytogetherparty');

-- Seed social profiles for Skills Dev Academy
INSERT INTO social_profiles (competitor_id, platform, handle, url) VALUES
  ((SELECT id FROM competitors WHERE slug = 'skills-dev-academy'), 'instagram', '@sdacademysg', 'https://www.instagram.com/sdacademysg/'),
  ((SELECT id FROM competitors WHERE slug = 'skills-dev-academy'), 'facebook', 'sdacademysg', 'https://www.facebook.com/sdacademysg'),
  ((SELECT id FROM competitors WHERE slug = 'skills-dev-academy'), 'linkedin', 'company/sdacademysg', 'https://www.linkedin.com/company/sdacademysg'),
  ((SELECT id FROM competitors WHERE slug = 'skills-dev-academy'), 'youtube', '@sdacademysg', 'https://www.youtube.com/@sdacademysg');

-- Seed social profiles for ASK Training
INSERT INTO social_profiles (competitor_id, platform, handle, url) VALUES
  ((SELECT id FROM competitors WHERE slug = 'ask-training'), 'instagram', '@ask.training.sg', 'https://www.instagram.com/ask.training.sg/'),
  ((SELECT id FROM competitors WHERE slug = 'ask-training'), 'facebook', 'ASKTraining.Singapore', 'https://www.facebook.com/ASKTraining.Singapore'),
  ((SELECT id FROM competitors WHERE slug = 'ask-training'), 'linkedin', 'company/ask-training-singapore', 'https://www.linkedin.com/company/ask-training-singapore');

-- Seed social profiles for OOm Pte Ltd
INSERT INTO social_profiles (competitor_id, platform, handle, url) VALUES
  ((SELECT id FROM competitors WHERE slug = 'oom-pte-ltd'), 'instagram', '@oom_sg', 'https://www.instagram.com/oom_sg/'),
  ((SELECT id FROM competitors WHERE slug = 'oom-pte-ltd'), 'facebook', 'oomsingapore', 'https://www.facebook.com/oomsingapore'),
  ((SELECT id FROM competitors WHERE slug = 'oom-pte-ltd'), 'linkedin', 'company/oom-sg', 'https://www.linkedin.com/company/oom-sg'),
  ((SELECT id FROM competitors WHERE slug = 'oom-pte-ltd'), 'youtube', 'c/OomSg', 'https://www.youtube.com/c/OomSg');

-- Seed social profiles for Heicoders Academy
INSERT INTO social_profiles (competitor_id, platform, handle, url) VALUES
  ((SELECT id FROM competitors WHERE slug = 'heicoders-academy'), 'instagram', '@heicoders_academy', 'https://www.instagram.com/heicoders_academy/'),
  ((SELECT id FROM competitors WHERE slug = 'heicoders-academy'), 'facebook', 'HeicodersProfessionals', 'https://www.facebook.com/HeicodersProfessionals'),
  ((SELECT id FROM competitors WHERE slug = 'heicoders-academy'), 'linkedin', 'company/heicoders-academy', 'https://www.linkedin.com/company/heicoders-academy'),
  ((SELECT id FROM competitors WHERE slug = 'heicoders-academy'), 'youtube', 'UC88OexyXkONUynCbzEJ9eog', 'https://www.youtube.com/channel/UC88OexyXkONUynCbzEJ9eog');

-- Seed social profiles for Equinet Academy
INSERT INTO social_profiles (competitor_id, platform, handle, url) VALUES
  ((SELECT id FROM competitors WHERE slug = 'equinet-academy'), 'instagram', '@equinet.academy', 'https://www.instagram.com/equinet.academy/'),
  ((SELECT id FROM competitors WHERE slug = 'equinet-academy'), 'facebook', 'equinetacademysingapore', 'https://www.facebook.com/equinetacademysingapore'),
  ((SELECT id FROM competitors WHERE slug = 'equinet-academy'), 'linkedin', 'school/equinetacademy', 'https://www.linkedin.com/school/equinetacademy'),
  ((SELECT id FROM competitors WHERE slug = 'equinet-academy'), 'youtube', '@equinetacademysg', 'https://www.youtube.com/@equinetacademysg');

-- Seed social profiles for BELLS Institute
INSERT INTO social_profiles (competitor_id, platform, handle, url) VALUES
  ((SELECT id FROM competitors WHERE slug = 'bells-institute'), 'instagram', '@bellsinstitute.sg', 'https://www.instagram.com/bellsinstitute.sg/'),
  ((SELECT id FROM competitors WHERE slug = 'bells-institute'), 'facebook', 'bellsinstitutesg', 'https://www.facebook.com/bellsinstitutesg'),
  ((SELECT id FROM competitors WHERE slug = 'bells-institute'), 'linkedin', 'company/bellssg', 'https://www.linkedin.com/company/bellssg');

-- Seed social profiles for InfoTech Academy
INSERT INTO social_profiles (competitor_id, platform, handle, url) VALUES
  ((SELECT id FROM competitors WHERE slug = 'infotech-academy'), 'instagram', '@infotechacademy.sg', 'https://www.instagram.com/infotechacademy.sg/'),
  ((SELECT id FROM competitors WHERE slug = 'infotech-academy'), 'facebook', 'infotechacademy.sg', 'https://www.facebook.com/infotechacademy.sg'),
  ((SELECT id FROM competitors WHERE slug = 'infotech-academy'), 'linkedin', 'school/infotech-academy-edu', 'https://www.linkedin.com/school/infotech-academy-edu');
